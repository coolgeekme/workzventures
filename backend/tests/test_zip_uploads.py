import io
import os
import sys
import zipfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from zip_uploads import MAX_ZIP_FILES, ZipUploadError, extract_zip_files


def _make_zip(entries, compression=zipfile.ZIP_DEFLATED):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression) as zipped:
        for name, data in entries:
            zipped.writestr(name, data)
    return output.getvalue()


def test_extracts_nested_files_and_infers_content_types():
    archive = _make_zip([
        ("Financials/Q1.csv", b"month,revenue\nJan,100\n"),
        ("Legal/contract.pdf", b"%PDF-test"),
        ("__MACOSX/._contract.pdf", b"metadata"),
        (".DS_Store", b"metadata"),
        ("empty.txt", b""),
    ])

    files = extract_zip_files(archive)

    assert [item.filename for item in files] == [
        "Financials/Q1.csv",
        "Legal/contract.pdf",
    ]
    assert files[0].content_type == "text/csv"
    assert files[0].data == b"month,revenue\nJan,100\n"
    assert files[1].content_type == "application/pdf"


@pytest.mark.parametrize("name", ["../secret.txt", "folder/../../secret.txt", "C:/secret.txt"])
def test_rejects_unsafe_member_paths(name):
    archive = _make_zip([(name, b"secret")])

    with pytest.raises(ZipUploadError, match="Unsafe path"):
        extract_zip_files(archive)


def test_rejects_corrupt_archives():
    with pytest.raises(ZipUploadError, match="invalid or corrupted"):
        extract_zip_files(b"not a zip file")


def test_rejects_excessive_file_counts():
    archive = _make_zip([
        (f"file-{index}.txt", b"x")
        for index in range(MAX_ZIP_FILES + 1)
    ], compression=zipfile.ZIP_STORED)

    with pytest.raises(ZipUploadError, match="file limit"):
        extract_zip_files(archive)


def test_rejects_suspicious_compression_ratio():
    archive = _make_zip([("zeros.bin", b"\0" * (1024 * 1024))])

    with pytest.raises(ZipUploadError, match="compression ratio"):
        extract_zip_files(archive)


def test_rejects_archive_with_only_empty_or_metadata_files():
    archive = _make_zip([
        ("empty.txt", b""),
        ("__MACOSX/._empty.txt", b"x"),
        (".DS_Store", b"x"),
    ])

    with pytest.raises(ZipUploadError, match="does not contain"):
        extract_zip_files(archive)
