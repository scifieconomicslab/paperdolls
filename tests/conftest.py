"""Shared test helpers.

Node tests need the npm packages in package.json (canvas, jsdom): run `npm ci` once in the repository root. On a machine that keeps
them elsewhere, point PAPERDOLLS_NODE_MODULES at that node_modules directory.
"""
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def node_env():
    """The environment for a node subprocess, with canvas and jsdom resolvable."""
    env = dict(os.environ)
    parts = [os.environ.get("PAPERDOLLS_NODE_MODULES", ""), str(ROOT / "node_modules"), env.get("NODE_PATH", "")]
    env["NODE_PATH"] = os.pathsep.join(p for p in parts if p)
    return env


def _model_present():
    from paperdolls import model_loader
    return model_loader.VENDOR.exists()


# The Great Retrofit model is not distributed with the plugin until its licence is confirmed (see vendor/greatretrofit_v2/NOTICE.md).
needs_model = pytest.mark.skipif(not _model_present(), reason="the vendored Great Retrofit model is not installed (vendor/greatretrofit_v2/model.py)")


@pytest.fixture(autouse=True)
def _no_outside_network(monkeypatch):
    """No test may reach a real server (Overpass in particular). Only loopback and unix sockets connect; tests use local fake servers."""
    import socket
    real = socket.socket.connect

    def guarded(self, address):
        host = address[0] if isinstance(address, tuple) else None
        if isinstance(host, str) and not (host.startswith("127.") or host in ("::1", "localhost")):
            raise OSError(f"tests must not use the network: refused to connect to {host}")
        return real(self, address)
    monkeypatch.setattr(socket.socket, "connect", guarded)
