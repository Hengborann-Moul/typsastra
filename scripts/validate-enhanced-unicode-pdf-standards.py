#!/usr/bin/env python3
"""Compile and optionally externally validate every supported PDF standard."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


BASE_STANDARDS = ("1.4", "1.5", "1.6", "1.7", "2.0")
ARCHIVAL_STANDARDS = (
    "a-1b",
    "a-1a",
    "a-2b",
    "a-2u",
    "a-2a",
    "a-3b",
    "a-3u",
    "a-3a",
    "a-4",
    "a-4f",
    "a-4e",
)
ACCESSIBILITY_STANDARDS = ("ua-1",)
COMBINED_STANDARDS = ("a-2a,ua-1", "a-3a,ua-1")

VERAPDF_FLAVOURS = {
    "a-1b": ("1b",),
    "a-1a": ("1a",),
    "a-2b": ("2b",),
    "a-2u": ("2u",),
    "a-2a": ("2a",),
    "a-3b": ("3b",),
    "a-3u": ("3u",),
    "a-3a": ("3a",),
    "a-4": ("4",),
    "a-4f": ("4f",),
    "a-4e": ("4e",),
    "ua-1": ("ua1",),
    "a-2a,ua-1": ("2a", "ua1"),
    "a-3a,ua-1": ("3a", "ua1"),
}


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    if sys.platform == "win32" and Path(command[0]).suffix.lower() in {".bat", ".cmd"}:
        command = ["cmd.exe", "/d", "/c", *command]
    print("+", " ".join(command), flush=True)
    return subprocess.run(command, check=True, text=True, capture_output=True)


def output_name(standard: str) -> str:
    return standard.replace(",", "_").replace(".", "-") + ".pdf"


def assert_pdf_header(path: Path, expected: str) -> None:
    header = path.read_bytes()[:8].decode("ascii", errors="replace")
    if header != f"%PDF-{expected}":
        raise RuntimeError(f"{path} has {header!r}; expected '%PDF-{expected}'")


def verapdf_is_compliant(report: str) -> bool:
    stripped = report.lstrip()
    if stripped.startswith("{"):
        payload = json.loads(report)
        jobs = payload.get("report", {}).get("jobs", [])
        return bool(jobs) and all(
            job.get("validationResult", {}).get("compliant") is True for job in jobs
        )
    return 'isCompliant="true"' in report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--typst", required=True, type=Path)
    parser.add_argument(
        "--fixture",
        type=Path,
        default=Path("tests/fixtures/enhanced-unicode/pdf-standards.typ"),
    )
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--verapdf", type=Path)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    standards = (
        BASE_STANDARDS
        + ARCHIVAL_STANDARDS
        + ACCESSIBILITY_STANDARDS
        + COMBINED_STANDARDS
    )

    compiled: dict[str, Path] = {}
    for standard in standards:
        output = args.output_dir / output_name(standard)
        result = run(
            [
                str(args.typst),
                "compile",
                "--pdf-standard",
                standard,
                str(args.fixture),
                str(output),
            ]
        )
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        if not output.is_file() or output.stat().st_size == 0:
            raise RuntimeError(f"Typst did not produce {output}")
        compiled[standard] = output

    for standard, expected_header in zip(BASE_STANDARDS, BASE_STANDARDS):
        assert_pdf_header(compiled[standard], expected_header)

    if args.verapdf:
        version = run([str(args.verapdf), "--version"])
        print(version.stdout.strip())
        for standard, flavours in VERAPDF_FLAVOURS.items():
            for flavour in flavours:
                result = run(
                    [
                        str(args.verapdf),
                        "--format",
                        "xml",
                        "--flavour",
                        flavour,
                        str(compiled[standard]),
                    ]
                )
                if not verapdf_is_compliant(result.stdout):
                    print(result.stdout, file=sys.stderr)
                    raise RuntimeError(
                        f"veraPDF rejected {compiled[standard]} as profile {flavour}"
                    )

    print(
        f"Validated {len(compiled)} PDF standard configuration(s)"
        + (" with veraPDF." if args.verapdf else ".")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
