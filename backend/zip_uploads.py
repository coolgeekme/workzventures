"""Safe, in-memory ZIP expansion for listing data-room uploads."""

from __future__ import annotations

import io
import mimetypes
import stat
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath


MAX_ZIP_FILES = 250
# Iter-52: Raised from 50/250 MB → 512/1024 MB to align with the new 512 MB
# per-file upload cap. A single ZIP can now carry a 512 MB workbook, and the
# total extracted payload is capped at 1 GB so a full mixed data-room dump
# still expands in one shot.
MAX_ZIP_MEMBER_BYTES = 512 * 1024 * 1024
MAX_ZIP_EXTRACTED_BYTES = 1024 * 1024 * 1024
MAX_ZIP_COMPRESSION_RATIO = 1000


class ZipUploadError(ValueError):
    """Raised when an uploaded archive cannot be expanded safely."""


@dataclass(frozen=True)
class ExtractedZipFile:
    filename: str
    data: bytes
    content_type: str


_CONTENT_TYPE_OVERRIDES = {
    ".csv": "text/csv",
    ".json": "application/json",
    ".md": "text/markdown",
    ".tsv": "text/tab-separated-values",
    ".txt": "text/plain",
}


def _content_type_for(filename: str) -> str:
    suffix = PurePosixPath(filename).suffix.lower()
    return (
        _CONTENT_TYPE_OVERRIDES.get(suffix)
        or mimetypes.guess_type(filename)[0]
        or "application/octet-stream"
    )


def _safe_member_name(raw_name: str) -> str:
    normalized = (raw_name or "").replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or any(part == ".." for part in path.parts):
        raise ZipUploadError(f"Unsafe path in ZIP: {raw_name}")

    parts = [part for part in path.parts if part not in ("", ".")]
    if not parts:
        return ""
    if ":" in parts[0]:
        raise ZipUploadError(f"Unsafe path in ZIP: {raw_name}")
    return "/".join(parts)


def extract_zip_files(archive: bytes) -> list[ExtractedZipFile]:
    """Expand regular files from a ZIP after validating resource limits."""
    try:
        zipped = zipfile.ZipFile(io.BytesIO(archive))
    except (zipfile.BadZipFile, OSError) as exc:
        raise ZipUploadError("The uploaded ZIP file is invalid or corrupted") from exc

    with zipped:
        members: list[tuple[zipfile.ZipInfo, str]] = []
        total_size = 0

        for info in zipped.infolist():
            name = _safe_member_name(info.filename)
            if info.is_dir() or not name:
                continue
            if name.startswith("__MACOSX/") or PurePosixPath(name).name == ".DS_Store":
                continue
            if info.flag_bits & 0x1:
                raise ZipUploadError(
                    f"Password-protected ZIP entries are not supported: {name}"
                )

            file_type = (info.external_attr >> 16) & 0o170000
            if file_type == stat.S_IFLNK:
                raise ZipUploadError(f"Symbolic links are not allowed in ZIP files: {name}")
            if info.file_size == 0:
                continue
            if info.file_size > MAX_ZIP_MEMBER_BYTES:
                raise ZipUploadError(
                    f"{name} exceeds the {MAX_ZIP_MEMBER_BYTES // (1024 * 1024)} MB per-file limit"
                )
            if (
                info.compress_size > 0
                and info.file_size / info.compress_size > MAX_ZIP_COMPRESSION_RATIO
            ):
                raise ZipUploadError(f"Unsafe compression ratio in ZIP entry: {name}")

            total_size += info.file_size
            if total_size > MAX_ZIP_EXTRACTED_BYTES:
                raise ZipUploadError(
                    f"ZIP contents exceed the {MAX_ZIP_EXTRACTED_BYTES // (1024*1024)} MB total extracted-size limit"
                )
            members.append((info, name))
            if len(members) > MAX_ZIP_FILES:
                raise ZipUploadError(
                    f"ZIP contains more than the {MAX_ZIP_FILES}-file limit"
                )

        if not members:
            raise ZipUploadError("The ZIP file does not contain any non-empty files")

        extracted: list[ExtractedZipFile] = []
        actual_total = 0
        try:
            for info, name in members:
                data = zipped.read(info)
                actual_total += len(data)
                if len(data) > MAX_ZIP_MEMBER_BYTES or actual_total > MAX_ZIP_EXTRACTED_BYTES:
                    raise ZipUploadError("ZIP contents exceed the allowed extracted-size limits")
                extracted.append(
                    ExtractedZipFile(
                        filename=name,
                        data=data,
                        content_type=_content_type_for(name),
                    )
                )
        except (RuntimeError, NotImplementedError, zipfile.BadZipFile) as exc:
            raise ZipUploadError("The ZIP file could not be extracted") from exc

    return extracted
