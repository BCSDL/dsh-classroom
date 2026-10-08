"""Read common engineering exchange formats using established CPU parsers."""
import json
from collections import Counter
from pathlib import Path

SUFFIXES = {'.dxf', '.step', '.stp', '.iges', '.igs', '.stl', '.obj', '.ply', '.off', '.glb', '.gltf'}


def preview_mesh(mesh, destination):
    import numpy as np
    import matplotlib
    matplotlib.use('Agg')
    from matplotlib import pyplot as plt
    figure = plt.figure(figsize=(8, 6))
    axis = figure.add_subplot(projection='3d')
    # A visual preview is sampled; numerical geometry statistics use the full mesh.
    selected = np.linspace(0, len(mesh.faces) - 1, min(20000, len(mesh.faces)), dtype=int)
    if len(selected):
        faces = mesh.faces[selected]
        axis.plot_trisurf(mesh.vertices[:, 0], mesh.vertices[:, 1], mesh.vertices[:, 2],
                          triangles=faces, color='steelblue', linewidth=0.1, alpha=0.9)
    axis.set(xlabel='X', ylabel='Y', zlabel='Z')
    axis.set_box_aspect(np.maximum(mesh.extents, 1e-9))
    figure.savefig(destination, dpi=140)
    plt.close(figure)
    return len(selected)


def read(path, output_dir):
    path, output_dir = Path(path), Path(output_dir)
    if path.suffix.lower() == '.dxf':
        import ezdxf
        from ezdxf.addons.drawing import Frontend, RenderContext
        from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
        import matplotlib
        matplotlib.use('Agg')
        from matplotlib import pyplot as plt
        drawing = ezdxf.readfile(path)
        layout = drawing.modelspace()
        counts = Counter(entity.dxftype() for entity in layout)
        if sum(counts.values()) > 100000:
            raise ValueError('DXF 超过 100000 个实体，请导出所需图层或区域再预览')
        texts = [entity.plain_text() if entity.dxftype() == 'MTEXT' else entity.dxf.text
                 for entity in layout if entity.dxftype() in {'TEXT', 'MTEXT'}]
        metadata = {'format': 'DXF', 'version': drawing.dxfversion, 'unitsCode': drawing.units,
                    'entities': dict(counts), 'layers': [layer.dxf.name for layer in drawing.layers],
                    'text': texts, 'coverage': 'modelspace preview; paperspace and unsupported proxy entities may differ'}
        figure = plt.figure(figsize=(10, 7))
        axis = figure.add_axes([0, 0, 1, 1])
        Frontend(RenderContext(drawing), MatplotlibBackend(axis)).draw_layout(layout, finalize=True)
        image = output_dir / (path.stem + '-dxf.png')
        figure.savefig(image, dpi=140)
        plt.close(figure)
    else:
        import trimesh
        suffix = path.suffix.lower()
        metadata = {'format': suffix, 'units': 'source units; verify before engineering calculations'}
        mesh_path = path
        if suffix in {'.step', '.stp', '.iges', '.igs'}:
            from OCP.IFSelect import IFSelect_RetDone
            from OCP.STEPControl import STEPControl_Reader
            from OCP.IGESControl import IGESControl_Reader
            from OCP.Bnd import Bnd_Box
            from OCP.BRepBndLib import BRepBndLib
            from OCP.BRepMesh import BRepMesh_IncrementalMesh
            from OCP.StlAPI import StlAPI_Writer
            reader = STEPControl_Reader() if suffix in {'.step', '.stp'} else IGESControl_Reader()
            if reader.ReadFile(str(path)) != IFSelect_RetDone:
                raise ValueError('OpenCascade 无法读取该交换文件')
            reader.TransferRoots()
            shape = reader.OneShape()
            if shape.IsNull():
                raise ValueError('交换文件没有可传递的几何体')
            box = Bnd_Box()
            BRepBndLib.Add_s(shape, box)
            minimum, maximum = box.CornerMin(), box.CornerMax()
            metadata.update(exactBounds=[minimum.X(), minimum.Y(), minimum.Z(), maximum.X(), maximum.Y(), maximum.Z()], transferredRoots=reader.NbRootsForTransfer(),
                            units='OpenCascade transfer units (normally mm); confirm file units',
                            coverage='transferred geometry and tessellated preview; feature history/constraints are not preserved')
            BRepMesh_IncrementalMesh(shape, 0.1, False, 0.5, True)
            mesh_path = output_dir / (path.stem + '-preview.stl')
            if not StlAPI_Writer().Write(shape, str(mesh_path)):
                raise ValueError('几何体无法生成预览网格')
        scene = trimesh.load_scene(str(mesh_path), process=True, allow_remote=False)
        mesh = scene.to_mesh()
        if not len(mesh.faces):
            raise ValueError('文件没有可预览的三角面')
        metadata.update(vertices=len(mesh.vertices), faces=len(mesh.faces), bounds=mesh.bounds.tolist(),
                        surfaceArea=float(mesh.area), watertight=bool(mesh.is_watertight))
        if mesh.is_watertight:
            metadata['volume'] = float(mesh.volume)
        image = output_dir / (path.stem + '-mesh.png')
        metadata['previewFaces'] = preview_mesh(mesh, image)
    yield {'source': path.name, 'text': json.dumps(metadata, ensure_ascii=False), 'image': str(image)}


if __name__ == '__main__':
    import sys
    try:
        print(json.dumps({'result': list(read(sys.argv[1], sys.argv[2]))}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), flush=True)
        sys.exit(1)
