"""
Vite asset helper for FastAPI - replacement for django-vite functionality.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional

from . import settings


class ViteAssets:
    """Helper class to handle Vite assets similar to django-vite."""

    def __init__(self):
        # Always use assets dir for manifest since that's where Vite builds to
        self.manifest_path = (
            settings.BASE_DIR / "assets" / "bundles" / ".vite" / "manifest.json"
        )
        self._manifest: Optional[Dict] = None

    @property
    def manifest(self) -> Dict:
        """Load and cache the Vite manifest."""
        if self._manifest is None:
            try:
                with open(self.manifest_path) as f:
                    self._manifest = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                self._manifest = {}
        return self._manifest

    def get_asset_urls(self, entry_name: str) -> Dict[str, List[str]]:
        """Get CSS and JS URLs for a given entry point."""
        if entry_name not in self.manifest:
            return {"css": [], "js": []}

        entry = self.manifest[entry_name]

        # Get JS file
        js_files = [f"/static/bundles/{entry['file']}"]

        # Get CSS files
        css_files = []
        if "css" in entry:
            css_files = [f"/static/bundles/{css_file}" for css_file in entry["css"]]

        return {"css": css_files, "js": js_files}

    def render_tags(self, entry_name: str) -> str:
        """Render HTML tags for CSS and JS assets."""
        if settings.DEBUG:
            # In debug mode, use Vite dev server
            return self._render_dev_tags(entry_name)
        else:
            # In production, use built assets
            return self._render_prod_tags(entry_name)

    def _render_dev_tags(self, entry_name: str) -> str:
        """Render tags for development mode with Vite dev server."""
        return f"""
    <script type="module" src="http://localhost:5173/{entry_name}"></script>"""

    def _render_prod_tags(self, entry_name: str) -> str:
        """Render tags for production mode with built assets."""
        urls = self.get_asset_urls(entry_name)

        tags = []

        # Add CSS tags
        for css_url in urls["css"]:
            tags.append(f'    <link rel="stylesheet" href="{css_url}">')

        # Add JS tags
        for js_url in urls["js"]:
            tags.append(f'    <script type="module" src="{js_url}"></script>')

        return "\n".join(tags)

    def render_hmr_client(self) -> str:
        """Render Vite HMR client for development."""
        if settings.DEBUG:
            return '    <script type="module" src="http://localhost:5173/@vite/client"></script>'
        return ""


# Global instance
vite_assets = ViteAssets()
