import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main():
    if len(sys.argv) < 2:
        print(
            json.dumps(
                {"status": "error", "message": "Usage: gds_backend <filepath.gds>"}
            )
        )
        sys.exit(1)

    filepath = sys.argv[1]

    if not os.path.exists(filepath):
        print(json.dumps({"status": "error", "message": f"File not found: {filepath}"}))
        sys.exit(1)

    try:
        from gds_inspector.inspector import inspect_gds

        result = inspect_gds(filepath)
        print(json.dumps(result, default=float))
    except Exception as e:
        print(
            json.dumps(
                {"status": "error", "message": str(e), "detail": traceback.format_exc()}
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
