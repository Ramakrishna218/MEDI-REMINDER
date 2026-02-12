import os
from datetime import date
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from supabase import Client, create_client


# Load environment variables from a .env file if present
load_dotenv()


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables."
    )


def get_supabase_client() -> Client:
    """
    Create and return a Supabase client instance.
    Uses the service role key so this code MUST run only on the backend.
    """
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


supabase: Client = get_supabase_client()

app = FastAPI(title="MediReminder API", version="1.0.0")

# Basic CORS configuration for local development.
# You can restrict this later to specific origins (e.g., http://localhost:5500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)


class AuthUser(BaseModel):
    id: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    user_metadata: Dict[str, Any] = Field(default_factory=dict)


class SignupRequest(BaseModel):
    identifier: str
    password: str
    full_name: Optional[str] = None
    username: Optional[str] = None
    dob: Optional[date] = None


class LoginRequest(BaseModel):
    identifier: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AuthUser


class MedicationBase(BaseModel):
    name: str
    dosage: str
    frequency: str
    time: str
    instructions: Optional[str] = None
    active: bool = True
    start_date: Optional[date] = None


class MedicationCreate(MedicationBase):
    pass


class MedicationUpdate(BaseModel):
    name: Optional[str] = None
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    time: Optional[str] = None
    instructions: Optional[str] = None
    active: Optional[bool] = None
    start_date: Optional[date] = None


class Medication(MedicationBase):
    id: Any
    user_id: str


class CaregiverBase(BaseModel):
    name: str
    relation: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    is_primary: bool = False


class CaregiverCreate(CaregiverBase):
    pass


class CaregiverUpdate(BaseModel):
    name: Optional[str] = None
    relation: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    is_primary: Optional[bool] = None


class Caregiver(CaregiverBase):
    id: Any
    user_id: str


class AlarmBase(BaseModel):
    medication_name: str
    dose: Optional[str] = None
    scheduled_time: str  # "HH:MM" in 24h format
    status: str = "upcoming"  # upcoming / taken / missed


class AlarmCreate(AlarmBase):
    pass


class AlarmUpdate(BaseModel):
    medication_name: Optional[str] = None
    dose: Optional[str] = None
    scheduled_time: Optional[str] = None
    status: Optional[str] = None


class Alarm(AlarmBase):
    id: Any
    user_id: str


def supabase_user_to_auth_user(user: Any) -> AuthUser:
    """
    Convert the Supabase user object into our AuthUser model.
    We defensively use getattr so this works whether Supabase returns
    a dataclass-like object or a simple dict-like structure.
    """
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user")

    # Try attribute access first, then dict-style
    def _get(obj: Any, key: str, default: Any = None) -> Any:
        if hasattr(obj, key):
            return getattr(obj, key)
        if isinstance(obj, dict):
            return obj.get(key, default)
        return default

    return AuthUser(
        id=str(_get(user, "id")),
        email=_get(user, "email"),
        phone=_get(user, "phone"),
        user_metadata=_get(user, "user_metadata", {}) or {},
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> AuthUser:
    """
    FastAPI dependency that validates the JWT using Supabase Auth.
    Expects an Authorization: Bearer <token> header.
    """
    if credentials is None or not credentials.scheme.lower() == "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid Authorization header"
        )

    token = credentials.credentials
    try:
        # Validate the token and fetch the user from Supabase
        result = supabase.auth.get_user(token)
        user = getattr(result, "user", None) if result is not None else None
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    return supabase_user_to_auth_user(user)


@app.post("/auth/signup", response_model=AuthResponse)
def signup(payload: SignupRequest) -> AuthResponse:
    """
    Sign a user up using Supabase Auth.
    The `identifier` can be an email or phone number. We store additional info
    like full_name, username, dob and joined date in Supabase user_metadata.
    """
    identifier = payload.identifier.strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="Identifier is required")

    is_email = "@" in identifier

    metadata: Dict[str, Any] = {
        "full_name": payload.full_name,
        "username": payload.username,
        "dob": payload.dob.isoformat() if payload.dob else None,
        "joined": date.today().strftime("%b %Y"),
    }

    try:
        if is_email:
            res = supabase.auth.sign_up(
                {
                    "email": identifier,
                    "password": payload.password,
                    "options": {"data": metadata},
                }
            )
        else:
            # Phone-based sign up
            res = supabase.auth.sign_up(
                {
                    "phone": identifier,
                    "password": payload.password,
                    "options": {"data": metadata},
                }
            )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Signup failed: {exc}")

    user = getattr(res, "user", None)
    session = getattr(res, "session", None)
    access_token = getattr(session, "access_token", None) if session else None

    if not user or not access_token:
        raise HTTPException(
            status_code=400,
            detail="Signup succeeded but no session was returned. Please verify your email/phone and try logging in.",
        )

    return AuthResponse(access_token=access_token, user=supabase_user_to_auth_user(user))


@app.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest) -> AuthResponse:
    """
    Log a user in using Supabase Auth.
    The `identifier` can be an email or phone number.
    """
    identifier = payload.identifier.strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="Identifier is required")

    is_email = "@" in identifier

    try:
        if is_email:
            res = supabase.auth.sign_in_with_password({"email": identifier, "password": payload.password})
        else:
            res = supabase.auth.sign_in_with_password({"phone": identifier, "password": payload.password})
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Login failed: {exc}")

    user = getattr(res, "user", None)
    session = getattr(res, "session", None)
    access_token = getattr(session, "access_token", None) if session else None

    if not user or not access_token:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return AuthResponse(access_token=access_token, user=supabase_user_to_auth_user(user))


@app.get("/auth/me", response_model=AuthUser)
async def get_me(current_user: AuthUser = Depends(get_current_user)) -> AuthUser:
    """
    Return the currently authenticated user based on the JWT.
    """
    return current_user


# =========================
# Medication Endpoints
# =========================


@app.get("/medicines", response_model=List[Medication])
async def list_medicines(current_user: AuthUser = Depends(get_current_user)) -> List[Medication]:
    try:
        resp = (
            supabase.table("medicines")
            .select("*")
            .eq("user_id", current_user.id)
            .order("created_at", desc=False)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch medicines: {exc}")


@app.post("/medicines", response_model=Medication, status_code=status.HTTP_201_CREATED)
async def create_medication(
    payload: MedicationCreate, current_user: AuthUser = Depends(get_current_user)
) -> Medication:
    data = payload.dict()
    data["user_id"] = current_user.id

    try:
        resp = supabase.table("medicines").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to create medication")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create medication: {exc}")


@app.put("/medicines/{med_id}", response_model=Medication)
async def update_medication(
    med_id: Any, payload: MedicationUpdate, current_user: AuthUser = Depends(get_current_user)
) -> Medication:
    update_data = {k: v for k, v in payload.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        resp = (
            supabase.table("medicines")
            .update(update_data)
            .eq("id", med_id)
            .eq("user_id", current_user.id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Medication not found")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update medication: {exc}")


@app.delete("/medicines/{med_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_medication(med_id: Any, current_user: AuthUser = Depends(get_current_user)) -> None:
    try:
        resp = (
            supabase.table("medicines")
            .delete()
            .eq("id", med_id)
            .eq("user_id", current_user.id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Medication not found")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete medication: {exc}")


# =========================
# Caregiver Endpoints
# =========================


@app.get("/caregivers", response_model=List[Caregiver])
async def list_caregivers(current_user: AuthUser = Depends(get_current_user)) -> List[Caregiver]:
    try:
        resp = (
            supabase.table("caregivers")
            .select("*")
            .eq("user_id", current_user.id)
            .order("created_at", desc=False)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch caregivers: {exc}")


@app.post("/caregivers", response_model=Caregiver, status_code=status.HTTP_201_CREATED)
async def create_caregiver(
    payload: CaregiverCreate, current_user: AuthUser = Depends(get_current_user)
) -> Caregiver:
    data = payload.dict()
    data["user_id"] = current_user.id

    try:
        resp = supabase.table("caregivers").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to create caregiver")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create caregiver: {exc}")


@app.put("/caregivers/{caregiver_id}", response_model=Caregiver)
async def update_caregiver(
    caregiver_id: Any, payload: CaregiverUpdate, current_user: AuthUser = Depends(get_current_user)
) -> Caregiver:
    update_data = {k: v for k, v in payload.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        resp = (
            supabase.table("caregivers")
            .update(update_data)
            .eq("id", caregiver_id)
            .eq("user_id", current_user.id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Caregiver not found")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update caregiver: {exc}")


@app.delete("/caregivers/{caregiver_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_caregiver(caregiver_id: Any, current_user: AuthUser = Depends(get_current_user)) -> None:
    try:
        resp = (
            supabase.table("caregivers")
            .delete()
            .eq("id", caregiver_id)
            .eq("user_id", current_user.id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Caregiver not found")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete caregiver: {exc}")


# =========================
# Alarm Endpoints
# =========================


@app.get("/alarms", response_model=List[Alarm])
async def list_alarms(current_user: AuthUser = Depends(get_current_user)) -> List[Alarm]:
    try:
        resp = (
            supabase.table("alarms")
            .select("*")
            .eq("user_id", current_user.id)
            .order("scheduled_time", desc=False)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch alarms: {exc}")


@app.post("/alarms", response_model=Alarm, status_code=status.HTTP_201_CREATED)
async def create_alarm(payload: AlarmCreate, current_user: AuthUser = Depends(get_current_user)) -> Alarm:
    data = payload.dict()
    data["user_id"] = current_user.id

    try:
        resp = supabase.table("alarms").insert(data).execute()
        if not resp.data:
            raise HTTPException(status_code=500, detail="Failed to create alarm")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create alarm: {exc}")


@app.put("/alarms/{alarm_id}", response_model=Alarm)
async def update_alarm(
    alarm_id: Any, payload: AlarmUpdate, current_user: AuthUser = Depends(get_current_user)
) -> Alarm:
    update_data = {k: v for k, v in payload.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        resp = (
            supabase.table("alarms")
            .update(update_data)
            .eq("id", alarm_id)
            .eq("user_id", current_user.id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Alarm not found")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update alarm: {exc}")


@app.delete("/alarms/{alarm_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alarm(alarm_id: Any, current_user: AuthUser = Depends(get_current_user)) -> None:
    try:
        resp = (
            supabase.table("alarms")
            .delete()
            .eq("id", alarm_id)
            .eq("user_id", current_user.id)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Alarm not found")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete alarm: {exc}")


@app.get("/")
async def root() -> Dict[str, str]:
    return {"message": "MediReminder API is running"}

