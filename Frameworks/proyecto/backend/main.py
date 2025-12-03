from fastapi import FastAPI, HTTPException, Query, Header, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr
from typing import Dict, Optional, List, Any
import os
import hashlib
import hmac
import secrets
import base64
import json
import shutil

# Cargar variables
from dotenv import load_dotenv
load_dotenv()

# Directorio donde se guardarán las "Clases" por usuario
BASE_DIR = os.path.dirname(__file__)
DUMP_DIR = os.path.join(BASE_DIR, "DumpData")
os.makedirs(DUMP_DIR, exist_ok=True)

# ============================================================================
# CONFIGURACIÓN DE LA APLICACIÓN
# ============================================================================

app = FastAPI(
    title="Test Server",
    description="Gestor de calificaciones (Clases)",
    version="1.0.0"
)

# Leer ALLOWED_ORIGINS desde variables de entorno. Puede ser:
# - Una cadena '*' para permitir todos los orígenes
# - Una lista separada por comas: 'http://127.0.0.1:5500,http://localhost:3000'
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "*")
if allowed_origins_env.strip() == "*":
    allow_origins = ["*"]
else:
    # Separar por comas y eliminar espacios en blanco
    allow_origins = [origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# MODELOS DE DATOS (usando Pydantic)
# ============================================================================

class Product(BaseModel):
    # "Clase": name obligatorio, price opcional (no requerido); parciales lista opcional
    name: str = Field(..., min_length=1, description="Nombre de la clase")
    price: float = Field(default=0.0, description="Precio / costo asociado a la clase (opcional)")
    is_offer: bool = Field(default=False, description="Indica si la clase está en oferta")
    partials: List[Dict[str, Any]] = Field(default_factory=list, description="Lista de parciales (ej: [{\"name\":\"Parcial 1\",\"max\":100}])")
    
    class Config:
        json_schema_extra = {
            "user": {
                "name": "Administrador",
                "email": "elian.hernandez.alp@cbtis258.edu.mx",
                "password": "0j0c0nlos0j0s",
                "is_admin": True
            }
        }


class ProductResponse(Product):
    """
    Respuesta para una Clase. Incluye item_id y owner (usuario propietario).
    """
    item_id: int = Field(..., description="ID único de la clase")
    owner: str = Field(..., description="Usuario propietario (username)")


class ProductsListResponse(BaseModel):
    """
    Lista de clases.
    """
    total: int = Field(..., description="Cantidad total de clases")
    items: List[ProductResponse] = Field(..., description="Lista de clases")


# ============================================================================
# MODELOS Y LÓGICA DE AUTENTICACIÓN
# ============================================================================

class UserBase(BaseModel):
    username: str = Field(..., min_length=3, description="Nombre de usuario")
    email: EmailStr = Field(..., description="Correo electrónico")


class UserCreate(UserBase):
    password: str = Field(..., min_length=6, description="Contraseña")


class UserResponse(UserBase):
    is_admin: bool = Field(default=False)


class LoginRequest(BaseModel):
    username_or_email: str = Field(..., description="Usuario o correo")
    password: str = Field(..., description="Contraseña")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=3)
    password: Optional[str] = Field(None, min_length=6)


# Almacenamiento en memoria para usuarios y sesiones
# users_store: username -> dict with keys: username, email, password_hash (salt$hash), is_admin
users_store: Dict[str, Dict] = {}
# email -> username
email_index: Dict[str, str] = {}
# token -> username
sessions: Dict[str, str] = {}

# Almacenamiento en memoria para clases
# item_id (int) -> ProductResponse
products_db: Dict[int, ProductResponse] = {}

# Helpers para hash de contraseñas
def _hash_password(password: str, salt: Optional[str] = None) -> str:
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 200_000)
    hashed = base64.b64encode(dk).decode('utf-8')
    return f"{salt}${hashed}"

def _verify_password(stored: str, provided_password: str) -> bool:
    try:
        salt, hashed = stored.split('$', 1)
    except ValueError:
        return False
    provided_hashed = _hash_password(provided_password, salt).split('$', 1)[1]
    # use hmac.compare_digest for timing-attack safe comparison
    return hmac.compare_digest(provided_hashed, hashed)

def create_user(user: UserCreate, is_admin: bool = False) -> UserResponse:
    username = user.username.lower()
    email = user.email.lower()
    if username in users_store:
        raise HTTPException(status_code=400, detail="El nombre de usuario ya existe")
    if email in email_index:
        raise HTTPException(status_code=400, detail="El correo ya está registrado")

    password_hash = _hash_password(user.password)
    users_store[username] = {
        "username": username,
        "email": email,
        "password_hash": password_hash,
        "is_admin": is_admin
    }
    email_index[email] = username
    # crear carpeta de usuario vacía
    os.makedirs(os.path.join(DUMP_DIR, username), exist_ok=True)
    return UserResponse(username=username, email=email, is_admin=is_admin)

def authenticate_user(username_or_email: str, password: str) -> Optional[Dict]:
    key = username_or_email.lower()
    user = None
    if key in users_store:
        user = users_store[key]
    elif key in email_index:
        username = email_index[key]
        user = users_store.get(username)
    if not user:
        return None
    if not _verify_password(user["password_hash"], password):
        return None
    return user

def create_session_for_user(username: str) -> str:
    token = secrets.token_urlsafe(32)
    sessions[token] = username
    return token

def get_user_by_token(token: str) -> Optional[Dict]:
    username = sessions.get(token)
    if not username:
        return None
    return users_store.get(username)


# ============================================================================
# FUNCIONES DE PERSISTENCIA: Guardado en DumpData por usuario (carpetas)
# ============================================================================

def _class_path(username: str, item_id: int) -> str:
    return os.path.join(DUMP_DIR, username, str(item_id))

def persist_class_to_disk(owner: str, item_id: int, data: Dict):
    path = _class_path(owner, item_id)
    os.makedirs(path, exist_ok=True)
    meta_path = os.path.join(path, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({
            "item_id": item_id,
            "name": data.get("name"),
            "price": data.get("price", 0.0),
            "is_offer": data.get("is_offer", False),
            "partials": data.get("partials", []),
            "owner": owner
        }, f, ensure_ascii=False, indent=2)

def remove_class_from_disk(owner: str, item_id: int):
    path = _class_path(owner, item_id)
    if os.path.isdir(path):
        shutil.rmtree(path)

def load_dumpdata_into_memory():
    """
    Carga las clases existentes en DumpData al iniciar el servidor.
    Formato esperado: DumpData/<username>/<item_id>/meta.json
    """
    products_db.clear()
    if not os.path.isdir(DUMP_DIR):
        return
    for username in os.listdir(DUMP_DIR):
        user_dir = os.path.join(DUMP_DIR, username)
        if not os.path.isdir(user_dir):
            continue
        for item_name in os.listdir(user_dir):
            item_dir = os.path.join(user_dir, item_name)
            if not os.path.isdir(item_dir):
                continue
            meta_path = os.path.join(item_dir, "meta.json")
            if not os.path.isfile(meta_path):
                continue
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                item_id = int(meta.get("item_id", item_name))
                prod = ProductResponse(
                    item_id=item_id,
                    name=meta.get("name", "Sin nombre"),
                    price=float(meta.get("price", 0)),
                    is_offer=bool(meta.get("is_offer", False)),
                    partials=meta.get("partials", []),
                    owner=meta.get("owner", username)
                )
                products_db[item_id] = prod
            except Exception:
                # ignorar entradas corruptas
                continue

# Cargar al inicio
load_dumpdata_into_memory()

# ============================================================================
# ENDPOINTS DE LA API
# ============================================================================

@app.get("/")
async def root():
    """
    Endpoint raíz que da la bienvenida.
    Útil para verificar que el servidor está corriendo.
    """
    return {
        "message": "Bienvenido al Test Server de Gestión de Clases",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/items/", response_model=ProductsListResponse)
async def get_all_products(authorization: Optional[str] = Header(None)):
    """
    Obtiene las clases visibles para el usuario:
    - Si no hay Authorization: devuelve lista vacía (front-end debe ocultar menú).
    - Si user es admin: devuelve todas.
    - Si user no es admin: devuelve solo sus clases.
    """
    if not authorization:
        return ProductsListResponse(total=0, items=[])
    try:
        scheme, token = authorization.split()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Formato de Authorization inválido")
    if scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Se requiere esquema Bearer")
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o expirado")
    username = user["username"]
    is_admin = user.get("is_admin", False)

    if is_admin:
        items_list = list(products_db.values())
    else:
        items_list = [p for p in products_db.values() if p.owner == username]
    return ProductsListResponse(total=len(items_list), items=items_list)


@app.get("/items/{item_id}", response_model=ProductResponse)
async def get_product(
    item_id: int,
    authorization: Optional[str] = Header(None),
    q: Optional[str] = Query(None, description="Parámetro de búsqueda opcional (no usado actualmente)")
):
    """
    Obtiene una clase específica por su ID.
    Solo el propietario o admin puede verla.
    """
    if item_id not in products_db:
        raise HTTPException(
            status_code=404,
            detail=f"Clase con ID {item_id} no encontrada"
        )

    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Falta cabecera Authorization")
    try:
        scheme, token = authorization.split()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Formato de Authorization inválido")
    if scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Se requiere esquema Bearer")
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o expirado")
    username = user["username"]
    is_admin = user.get("is_admin", False)

    existing = products_db[item_id]
    if not is_admin and existing.owner != username:
        raise HTTPException(status_code=403, detail="No tiene permiso para ver esta clase")

    return existing


@app.put("/items/{item_id}", response_model=ProductResponse)
async def create_or_update_product(item_id: int, product: Product, authorization: Optional[str] = Header(None)):
    """
    Crea o actualiza una Clase. Los datos se guardan en DumpData/<username>/<item_id>/meta.json.
    Requiere autenticación (cabecera Authorization: Bearer <token>).
    """
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Falta cabecera Authorization")
    try:
        scheme, token = authorization.split()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Formato de Authorization inválido")
    if scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Se requiere esquema Bearer")
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o expirado")
    username = user["username"]

    # Si la clase ya existe y pertenece a otro usuario, prohibir la sobreescritura
    existing = products_db.get(item_id)
    if existing and existing.owner != username and not user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="La clase ya existe y pertenece a otro usuario")

    # Guardar en disco bajo DumpData/<username>/<item_id>
    persist_class_to_disk(username, item_id, product.dict())

    # Actualizar memoria
    prod_resp = ProductResponse(
        item_id=item_id,
        name=product.name,
        price=product.price,
        is_offer=product.is_offer,
        partials=product.partials,
        owner=username
    )
    products_db[item_id] = prod_resp

    return prod_resp


@app.delete("/items/{item_id}")
async def delete_product(item_id: int, authorization: Optional[str] = Header(None)):
    """
    Elimina una clase por su ID. Solo el propietario o admin puede eliminarla.
    """
    if item_id not in products_db:
        raise HTTPException(
            status_code=404,
            detail=f"Clase con ID {item_id} no encontrada"
        )

    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Falta cabecera Authorization")
    try:
        scheme, token = authorization.split()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Formato de Authorization inválido")
    if scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Se requiere esquema Bearer")
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o expirado")
    username = user["username"]
    is_admin = user.get("is_admin", False)

    existing = products_db[item_id]
    if not is_admin and existing.owner != username:
        raise HTTPException(status_code=403, detail="Solo el propietario o admin puede eliminar esta clase")

    # Remover del disco y de memoria
    remove_class_from_disk(existing.owner, item_id)
    products_db.pop(item_id, None)

    return {
        "message": f"Clase '{existing.name}' eliminada exitosamente",
        "item_id": item_id
    }


# ============================================================================
# ENDPOINTS DE AUTENTICACIÓN
# ============================================================================

@app.post("/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(user: UserCreate):
    """
    Registrar una nueva cuenta y crear sesión automáticamente.
    Devuelve TokenResponse (access_token + user).
    """
    created = create_user(user)
    token = create_session_for_user(created.username)
    user_resp = UserResponse(username=created.username, email=created.email, is_admin=created.is_admin)
    return TokenResponse(access_token=token, token_type="bearer", user=user_resp)

@app.post("/auth/login", response_model=TokenResponse)
async def login(credentials: LoginRequest):
    """
    Iniciar sesión con usuario o email y contraseña.
    Devuelve un token simple (sesión en memoria).
    """
    user = authenticate_user(credentials.username_or_email, credentials.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")
    token = create_session_for_user(user["username"])
    user_resp = UserResponse(username=user["username"], email=user["email"], is_admin=user.get("is_admin", False))
    return TokenResponse(access_token=token, token_type="bearer", user=user_resp)

@app.get("/auth/check/{username}")
async def check_username(username: str):
    """
    Verifica si un nombre de usuario existe.
    """
    exists = username.lower() in users_store
    return {"username": username, "exists": exists}

@app.get("/auth/me", response_model=UserResponse)
async def me(authorization: Optional[str] = Header(None)):
    """
    Obtener datos del usuario actual a partir del token Bearer.
    """
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Falta cabecera Authorization")
    try:
        scheme, token = authorization.split()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Formato de Authorization inválido")
    if scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Se requiere esquema Bearer")
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o expirado")
    return UserResponse(username=user["username"], email=user["email"], is_admin=user.get("is_admin", False))


@app.patch("/auth/me", response_model=UserResponse)
async def update_account(update: UserUpdate, authorization: Optional[str] = Header(None)):
    """
    Editar cuenta: cambiar username y/o contraseña.
    Si cambia username se renombra la carpeta en DumpData y se actualizan índices.
    """
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Falta cabecera Authorization")
    try:
        scheme, token = authorization.split()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Formato de Authorization inválido")
    if scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Se requiere esquema Bearer")
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o expirado")

    username = user["username"]
    if update.username:
        new_username = update.username.lower()
        if new_username != username and new_username in users_store:
            raise HTTPException(status_code=400, detail="El nuevo nombre de usuario ya existe")
        # actualizar users_store key
        data = users_store.pop(username)
        data["username"] = new_username
        users_store[new_username] = data
        # actualizar email_index (email stays same)
        email_index[data["email"]] = new_username
        # mover carpeta DumpData
        old_dir = os.path.join(DUMP_DIR, username)
        new_dir = os.path.join(DUMP_DIR, new_username)
        if os.path.isdir(old_dir):
            os.makedirs(os.path.dirname(new_dir), exist_ok=True)
            try:
                os.rename(old_dir, new_dir)
            except Exception:
                # fallback: copy & remove
                shutil.copytree(old_dir, new_dir)
                shutil.rmtree(old_dir)
        # actualizar producto owners en memoria
        for pid, prod in list(products_db.items()):
            if prod.owner == username:
                prod.owner = new_username
                # actualizar meta.json owner si existe
                meta_path = os.path.join(DUMP_DIR, new_username, str(pid), "meta.json")
                if os.path.isfile(meta_path):
                    try:
                        with open(meta_path, "r+", encoding="utf-8") as f:
                            meta = json.load(f)
                            meta["owner"] = new_username
                            f.seek(0); f.truncate()
                            json.dump(meta, f, ensure_ascii=False, indent=2)
                    except Exception:
                        pass
        # actualizar sesiones que apuntan al username
        for t, u in list(sessions.items()):
            if u == username:
                sessions[t] = new_username
        username = new_username
        user = users_store[username]

    if update.password:
        users_store[username]["password_hash"] = _hash_password(update.password)

    return UserResponse(username=username, email=users_store[username]["email"], is_admin=users_store[username].get("is_admin", False))


@app.delete("/auth/me")
async def delete_account(authorization: Optional[str] = Header(None)):
    """
    Borrar la cuenta autenticada: elimina usuario, sesiones y DumpData/<username>.
    """
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Falta cabecera Authorization")
    try:
        scheme, token = authorization.split()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Formato de Authorization inválido")
    if scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Se requiere esquema Bearer")
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o expirado")

    username = user["username"]
    # eliminar carpeta de usuario
    user_dir = os.path.join(DUMP_DIR, username)
    if os.path.isdir(user_dir):
        shutil.rmtree(user_dir)
    # eliminar de memory: usuarios y sus clases
    users_store.pop(username, None)
    email_index.pop(user["email"], None)
    # eliminar sesiones del usuario
    for t, u in list(sessions.items()):
        if u == username:
            sessions.pop(t, None)
    # eliminar clases del products_db que pertenecían al usuario
    for pid, prod in list(products_db.items()):
        if prod.owner == username:
            products_db.pop(pid, None)
    return {"message": f"Cuenta '{username}' eliminada"}

# ============================================================================
# PUNTO DE ENTRADA
# ============================================================================
if __name__ == "__main__":
    import uvicorn

    # Leer configuración desde variables de entorno (o usar valores por defecto)
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    reload_env = os.getenv("RELOAD", "true").lower()
    reload_flag = reload_env in ("1", "true", "yes", "y")

    # Ejecutar el servidor con la configuración obtenida
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=reload_flag
    )
