import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.agents import router as agents_router


def create_app() -> FastAPI:
    app = FastAPI(title="AiREC Agent Service", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(agents_router, prefix="")
    return app


app = create_app()

