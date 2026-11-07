"""Build the orbital assembly, compact projection mesh, and studio captures.

Run from the repository root with Blender 5.x and cwebp on PATH:
    blender -b --factory-startup -P design/orbit/render.py -- --output assets/orbit
"""

import argparse
import gzip
import struct
import math
import shutil
import subprocess
import sys
import tempfile
from math import cos, pi, sin
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--output", type=Path, required=True, help="Destination for the WebP views"
)
mode = parser.add_mutually_exclusive_group()
mode.add_argument(
    "--mesh", action="store_true", help="Export the real-time projection mesh"
)
mode.add_argument(
    "--frame",
    type=int,
    choices=range(72),
    metavar="0..71",
    help="Render a single view; 0 is the high-resolution poster.",
)
args = parser.parse_args(
    sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
)
cwebp = shutil.which("cwebp")
if not args.mesh and not cwebp:
    parser.error(
        "Install the libwebp command-line tools and make cwebp available on PATH."
    )
args.output.mkdir(parents=True, exist_ok=True)

FULL_TURN = 2 * pi
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
root = bpy.data.objects.new("Orbital assembly", None)
scene.collection.objects.link(root)


def material(name, base, roughness, metal, brushed=False):
    material_block = bpy.data.materials.new(name)
    material_block.use_nodes = True
    tree = material_block.node_tree
    shader = tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (base, base, base, 1)
    shader.inputs["Metallic"].default_value = metal
    shader.inputs["Roughness"].default_value = roughness
    if brushed:
        coordinates = tree.nodes.new("ShaderNodeTexCoord")
        noise = tree.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 220
        noise.inputs["Detail"].default_value = 1.6
        tree.links.new(coordinates.outputs["Object"], noise.inputs["Vector"])
        roughness_range = tree.nodes.new("ShaderNodeMapRange")
        roughness_range.inputs["To Min"].default_value = roughness * 0.72
        roughness_range.inputs["To Max"].default_value = roughness * 1.68
        tree.links.new(noise.outputs["Fac"], roughness_range.inputs["Value"])
        tree.links.new(roughness_range.outputs["Result"], shader.inputs["Roughness"])
    return material_block


silver = material("Machined titanium", 0.57, 0.23, 0.94, True)
rim = material("Bright cut edge", 0.82, 0.15, 0.99)
black = material("Blackened nickel", 0.065, 0.29, 0.92, True)
dark = material("Recessed carbon", 0.013, 0.39, 0.64)
inset = material("Fastener insert", 0.027, 0.26, 0.86)
ceramic = material("Polished silicon", 0.21, 0.16, 0.98)


def ring_parent(label, normal):
    mount = bpy.data.objects.new(label, None)
    scene.collection.objects.link(mount)
    mount.parent = root
    mount.rotation_euler = Vector(normal).to_track_quat("Z", "Y").to_euler()
    return mount


# Sweep a beveled closed radial profile. The bevels are built into the surface,
# so edge reflections remain stable across the very shallow machined contours.
def profile(name, points, parent, mat, start=0, end=FULL_TURN, segments=192):
    if args.mesh:
        segments = min(segments, 80)
    closed = abs(end - start - FULL_TURN) < 0.00001
    count = segments if closed else segments + 1
    vertices = []
    faces = []
    profile_size = len(points)
    for i in range(count):
        angle = start + (end - start) * i / segments
        for r, z in points:
            vertices.append((r * cos(angle), r * sin(angle), z))
    for i in range(segments):
        next_slice = (i + 1) % count
        for point in range(profile_size):
            faces.append(
                (
                    i * profile_size + point,
                    next_slice * profile_size + point,
                    next_slice * profile_size + (point + 1) % profile_size,
                    i * profile_size + (point + 1) % profile_size,
                )
            )
    if not closed:
        faces.extend(
            [
                tuple(reversed(range(profile_size))),
                tuple(segments * profile_size + point for point in range(profile_size)),
            ]
        )
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def band(
    name,
    inner,
    outer,
    bottom,
    top,
    parent,
    mat,
    edge=0.012,
    start=0,
    end=FULL_TURN,
    segments=192,
):
    bevel = min(edge, (outer - inner) * 0.28, (top - bottom) * 0.26)
    points = [
        (inner + bevel, bottom),
        (outer - bevel, bottom),
        (outer, bottom + bevel),
        (outer, top - bevel),
        (outer - bevel, top),
        (inner + bevel, top),
        (inner, top - bevel),
        (inner, bottom + bevel),
    ]
    return profile(name, points, parent, mat, start, end, segments)


def fasteners(parent, radius, z, count, offset=0, scale=1):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=24, radius=0.058 * scale, depth=0.023 * scale
    )
    head = bpy.context.object
    head.name = "Fastener head"
    head.data.materials.append(rim)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=6, radius=0.029 * scale, depth=0.024 * scale
    )
    socket = bpy.context.object
    socket.data.materials.append(inset)
    socket.name = "Hex socket"
    originals = [head, socket]
    for i in range(count):
        angle = offset + i * FULL_TURN / count
        for j, original in enumerate(originals):
            part = original if i == 0 else original.copy()
            if i:
                scene.collection.objects.link(part)
            part.parent = parent
            part.location = (radius * cos(angle), radius * sin(angle), z + j * 0.0009)
            part.rotation_euler.z = angle


def ring(label, normal, radius, width, height, kind):
    mount = ring_parent(label, normal)
    inner_radius = radius - width
    half_height = height / 2
    band(
        label + " frame",
        inner_radius,
        radius,
        -half_height,
        half_height,
        mount,
        black if kind == "outer" else silver,
        0.04,
    )
    for side in [-1, 1]:
        face_height = side * half_height
        for inner_edge, outer_edge, finish, protrusion in [
            (inner_radius, inner_radius + width * 0.105, rim, 0.026),
            (inner_radius + width * 0.18, inner_radius + width * 0.28, silver, 0.008),
            (
                inner_radius + width * 0.32,
                inner_radius + width * 0.79,
                silver if kind != "middle" else black,
                0.017,
            ),
            (radius - width * 0.13, radius, rim, 0.026),
        ]:
            bottom, top = sorted(
                [face_height - 0.004 * side, face_height + protrusion * side]
            )
            band(
                label + " face rail",
                inner_edge,
                outer_edge,
                bottom,
                top,
                mount,
                finish,
                0.005,
            )
    # Edge tires have fine circular grooves between raised guide rails.
    for height_fraction, finish in [
        (-0.73, silver),
        (-0.49, black),
        (-0.20, silver),
        (0.20, silver),
        (0.49, black),
        (0.73, silver),
    ]:
        band(
            label + " edge lamina",
            radius - 0.009,
            radius + 0.008,
            height_fraction * half_height - 0.009,
            height_fraction * half_height + 0.009,
            mount,
            finish,
            0.004,
        )
    tick_count = 96 if kind == "outer" else 60
    for i in range(tick_count):
        angle = i * FULL_TURN / tick_count
        longmark = i % 8 == 0
        tick_start = inner_radius + width * (0.4 if longmark else 0.54)
        band(
            "Radial index cut",
            tick_start,
            inner_radius + width * 0.74,
            half_height + 0.018,
            half_height + 0.020,
            mount,
            dark,
            0.001,
            angle,
            angle + (0.006 if longmark else 0.0025),
            1,
        )
    if kind == "outer":
        # Engrave angular graduations into the broad outer face.
        for i in range(12):
            angle = FULL_TURN * i / 12 + 0.06
            curve = bpy.data.curves.new("Degree scale", "FONT")
            curve.body = f"{i*30:03}"
            curve.size = 0.087
            curve.space_character = 1.09
            curve.align_x = "CENTER"
            curve.align_y = "CENTER"
            curve.materials.append(inset)
            glyph = bpy.data.objects.new("Degree graduation", curve)
            scene.collection.objects.link(glyph)
            glyph.parent = mount
            glyph.location = (
                (inner_radius + width * 0.50) * cos(angle),
                (inner_radius + width * 0.50) * sin(angle),
                half_height + 0.022,
            )
            glyph.rotation_euler.z = angle - pi / 2
        # Four graphite service plates punctuate the continuous silver scales.
        for i in range(4):
            angle = FULL_TURN * i / 4 + 0.10
            band(
                "Arc retainer",
                inner_radius + width * 0.28,
                radius - width * 0.13,
                half_height + 0.018,
                half_height + 0.044,
                mount,
                black,
                0.008,
                angle,
                angle + 0.26,
                13,
            )
        fasteners(
            mount, inner_radius + width * 0.51, half_height + 0.055, 4, 0.23, 0.82
        )
    else:
        fasteners(
            mount, inner_radius + width * 0.53, half_height + 0.018, 12, 0.12, 0.58
        )
    return mount


outer_normal = Vector((-0.47, -0.65, 0.61)).normalized()
middle_normal = Vector((0.73, -0.22, 0.65)).normalized()
inner_normal = Vector((0.11, -0.84, -0.52)).normalized()
ring("Outer race", outer_normal, 2.49, 0.29, 0.31, "outer")
ring("Intermediate gimbal", middle_normal, 1.99, 0.235, 0.245, "middle")
ring("Gyroscope wheel", inner_normal, 1.46, 0.28, 0.245, "inner")


# Bearing pins lie on the line shared by neighboring ring planes.
def shaft(name, start, end, radius):
    delta = end - start
    mount = ring_parent(name, delta.normalized())
    mount.location = (start + end) * 0.5
    half_length = delta.length / 2
    band(
        name + " axle",
        0.02,
        radius,
        -half_length,
        half_length,
        mount,
        black,
        edge=0.015,
        segments=48,
    )
    for fraction in [-0.83, -0.65, 0.65, 0.83]:
        band(
            name + " shoulder",
            radius * 0.92,
            radius * 1.16,
            half_length * fraction - 0.02,
            half_length * fraction + 0.02,
            mount,
            silver,
            edge=0.007,
            segments=48,
        )
    for side in [-1, 1]:
        cap_height = half_length * side
        bottom, top = sorted([cap_height, cap_height + 0.035 * side])
        band(
            name + " cap",
            0.015,
            radius * 1.1,
            bottom,
            top,
            mount,
            rim,
            edge=0.008,
            segments=48,
        )
        bottom, top = sorted([cap_height + 0.036 * side, cap_height + 0.038 * side])
        band(
            name + " slot",
            0.004,
            radius * 0.42,
            bottom,
            top,
            mount,
            inset,
            edge=0.0002,
            segments=6,
        )


for normal_a, normal_b, inner_radius, outer_radius, pin_radius in [
    (outer_normal, middle_normal, 1.87, 2.52, 0.123),
    (middle_normal, inner_normal, 1.34, 2.02, 0.128),
]:
    axis = normal_a.cross(normal_b).normalized()
    for side in [-1, 1]:
        shaft(
            "Trunnion",
            axis * inner_radius * side,
            axis * outer_radius * side,
            pin_radius,
        )

# The core is a reflective alloy rotor between two pronounced equatorial seams.
spindle = Vector((-0.79, -0.24, 0.57)).normalized()
for side in [-1, 1]:
    shaft("Rotor spindle", spindle * 0.58 * side, spindle * 1.33 * side, 0.124)
bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=64, radius=0.65)
core = bpy.context.object
core.name = "Gyroscope rotor"
core.parent = root
core.data.materials.append(ceramic)
for f in core.data.polygons:
    f.use_smooth = True
rotor_mount = ring_parent("Rotor casing", spindle)
for z in [-0.22, -0.185, 0.0, 0.185, 0.22]:
    rad = math.sqrt(0.65**2 - z**2)
    band(
        "Rotor seam",
        rad - 0.012,
        rad + 0.014,
        z - 0.011,
        z + 0.011,
        rotor_mount,
        rim if abs(z) == 0.22 else black,
        0.003,
        segments=128,
    )

# Centered orthographic product view. The film is transparent so the site can
# keep a true matte-black ground at any viewport size.
camdata = bpy.data.cameras.new("Studio camera")
cam = bpy.data.objects.new("Studio camera", camdata)
scene.collection.objects.link(cam)
cam.location = (0, -12, 0)
cam.rotation_euler = Vector((0, 1, 0)).to_track_quat("-Z", "Y").to_euler()
camdata.type = "ORTHO"
camdata.ortho_scale = 5.45
scene.camera = cam


def area(label, position, power, width, height):
    light_data = bpy.data.lights.new(label, "AREA")
    light_data.energy = power
    light_data.shape = "RECTANGLE"
    light_data.size = width
    light_data.size_y = height
    light_object = bpy.data.objects.new(label, light_data)
    scene.collection.objects.link(light_object)
    light_object.location = position
    light_object.rotation_euler = (
        (-Vector(position)).to_track_quat("-Z", "Y").to_euler()
    )


area("Broad high key", (-4, -4, 6), 575, 7, 3)
area("Vertical front strip", (3, -5, 1), 380, 1.3, 6)
area("Upper back rim", (2, 3, 4), 840, 6, 2)
area("Low return", (-2, 1, -4), 345, 5, 1)
area("Left line", (-5, -1, 0), 140, 0.5, 4)
world = bpy.data.worlds.new("Dark studio")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.14, 0.14, 0.14, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.65
scene.render.engine = "CYCLES"

scene.cycles.use_denoising = True
scene.cycles.max_bounces = 4
scene.render.use_persistent_data = True
scene.render.film_transparent = True
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.view_settings.view_transform = "AgX"


def render_view(index, temporary_directory):
    poster = index == 0
    root.rotation_euler.z = FULL_TURN * index / 72
    scene.render.resolution_x = scene.render.resolution_y = 1080 if poster else 740
    scene.cycles.samples = 44 if poster else 16
    png = temporary_directory / "view.png"
    scene.render.filepath = str(png)
    bpy.ops.render.render(write_still=True)

    name = "poster.webp" if poster else f"angle-{index:02}.webp"
    encoded = temporary_directory / name
    subprocess.run(
        [
            cwebp,
            "-quiet",
            "-q",
            "89" if poster else "82",
            "-alpha_q",
            "92" if poster else "88",
            str(png),
            "-o",
            str(encoded),
        ],
        check=True,
    )
    shutil.copyfile(encoded, args.output / name)


def export_mesh():
    # The studio captures carry the hairline graduations, brushed surfaces and
    # engraved text. The proxy retains the rings, guard rails, core and pivots
    # that define their silhouette and the depth between concentric surfaces.
    finishes = {
        material.name: i
        for i, material in enumerate([silver, rim, black, dark, inset, ceramic])
    }
    vertices = {}
    indices = []
    bpy.context.view_layer.update()
    for part in sorted(root.children_recursive, key=lambda obj: obj.name):
        if (
            part.type != "MESH"
            or part.name.startswith("Radial index cut")
            or "edge lamina" in part.name
        ):
            continue
        mesh = part.data
        mesh.calc_loop_triangles()
        finish = finishes[mesh.materials[0].name]
        local_indices = []
        for vertex in mesh.vertices:
            world = part.matrix_world @ vertex.co
            key = (*[round(value * 10000) for value in world], finish)
            if key not in vertices:
                vertices[key] = len(vertices)
            local_indices.append(vertices[key])
        # Blender may return tessellated faces in different thread order.
        triangles = sorted(
            tuple(local_indices[index] for index in face.vertices)
            for face in mesh.loop_triangles
        )
        for triangle in triangles:
            indices.extend(triangle)

    index_bytes = 2 if len(vertices) <= 65535 else 4
    output = bytearray(
        struct.pack("<4sIII", b"ORB1", len(vertices), len(indices), index_bytes)
    )
    for vertex in vertices:
        output.extend(struct.pack("<4h", *vertex))
    index_format = "<" + ("H" if index_bytes == 2 else "I")
    for index in indices:
        output.extend(struct.pack(index_format, index))
    (args.output / "assembly.mesh.gz").write_bytes(
        gzip.compress(output, compresslevel=9, mtime=0)
    )
    print(f"Orbital mesh: {len(vertices):,} vertices, {len(indices)//3:,} triangles")


with tempfile.TemporaryDirectory() as directory:
    if args.mesh:
        export_mesh()
    else:
        for frame in range(72) if args.frame is None else [args.frame]:
            render_view(frame, Path(directory))
