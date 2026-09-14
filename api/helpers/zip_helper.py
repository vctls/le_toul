import zipfile
from pathlib import Path


def create_zip_file(zip_path: Path, files: list[tuple[Path, str]]) -> Path:
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for source_path, zip_name in files:
            zip_file.write(source_path, zip_name)

    return zip_path
