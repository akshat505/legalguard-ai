"""
Simple authentication module for LegalGuard AI.
Handles signup, login, and session token verification using MongoDB.
"""

import uuid
import secrets
from datetime import datetime, timezone
from passlib.context import CryptContext
from fastapi import Header, HTTPException

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_user(users_collection, username: str, email: str, password: str) -> dict:
    """Creates a new user. Raises ValueError if username/email already exists."""
    if users_collection.find_one({"username": username}):
        raise ValueError("Username already taken.")
    if users_collection.find_one({"email": email}):
        raise ValueError("Email already registered.")

    user = {
        "_id": str(uuid.uuid4()),
        "username": username,
        "email": email,
        "password_hash": hash_password(password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    users_collection.insert_one(user)
    return {"user_id": user["_id"], "username": username, "email": email}


def authenticate_user(users_collection, username: str, password: str) -> dict:
    """Verifies credentials. Raises ValueError if invalid."""
    user = users_collection.find_one({"username": username})
    if not user or not verify_password(password, user["password_hash"]):
        raise ValueError("Invalid username or password.")
    return {"user_id": user["_id"], "username": user["username"], "email": user["email"]}


def create_session(sessions_collection, user_id: str) -> str:
    """Creates a new session token for a user and stores it in MongoDB."""
    token = secrets.token_hex(32)
    sessions_collection.insert_one({
        "_id": token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return token


def get_current_user(sessions_collection, authorization: str = Header(None)) -> str:
    """
    FastAPI dependency: reads the Authorization header (format: "Bearer <token>"),
    validates the session, and returns the user_id. Raises 401 if invalid/missing.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated. Please log in.")

    token = authorization.replace("Bearer ", "").strip()
    session = sessions_collection.find_one({"_id": token})
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid. Please log in again.")

    return session["user_id"]