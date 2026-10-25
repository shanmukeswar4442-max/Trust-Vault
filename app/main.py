from fastapi import FastAPI

from .db import Base, engine
from . import models  # noqa: F401  (importing registers the tables)

Base.metadata.create_all(engine)

app = FastAPI(title="TrustVault")


@app.get("/health")
def health():
    return {"ok": True}