import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

from app.routers.separation import router as separation_router, _planner

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize Vertex AI Gemini client on startup."""
    try:
        import vertexai
        from vertexai.generative_models import GenerativeModel

        project_id = os.getenv("GCP_PROJECT_ID", "gdg-hack-492906")
        location = os.getenv("GCP_LOCATION", "us-central1")

        vertexai.init(project=project_id, location=location)
        model = GenerativeModel("gemini-1.5-flash")
        _planner._llm = model
        logger.info("Vertex AI Gemini client initialized (project=%s, location=%s)", project_id, location)
    except Exception as exc:
        logger.warning("Could not initialize Vertex AI client: %s. LLM calls will fail.", exc)
    yield


app = FastAPI(title="Pathfinder API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(separation_router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Return HTTP 422 with a descriptive error body listing each validation failure."""
    errors = []
    for err in exc.errors():
        errors.append({
            "loc": list(err.get("loc", [])),
            "msg": err.get("msg", ""),
            "type": err.get("type", ""),
        })
    return JSONResponse(
        status_code=422,
        content={"error": "Validation error", "detail": errors},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Return HTTP 500 with a generic error message and log the detailed error internally."""
    logger.error("Unhandled exception: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": []},
    )
