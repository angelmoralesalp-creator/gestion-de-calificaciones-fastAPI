from fastapi import FastAPI, HTTPException, Query, Header, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr
from typing import Dict, Optional, List, Any
import os
import json
import secrets
import hashlib
import base64
import hmac
import shutil
import uuid
from dotenv import load_dotenv

# Cargar variables
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
    description="Gestor de calificaciones",
    version="alpha"
)

# Leer ALLOWED_ORIGINS desde variables de entorno y configurar CORS.
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "*")
if allowed_origins_env.strip() == "*":
    allow_origins = ["*"]
else:
    allow_origins = [origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()]

# En desarrollo, asegurar que Live Server esté permitido
dev_live_origin = "http://127.0.0.1:5500"
dev_live_origin_alt = "http://localhost:5500"
if allow_origins != ["*"]:
    if dev_live_origin not in allow_origins:
        allow_origins.append(dev_live_origin)
    if dev_live_origin_alt not in allow_origins:
        allow_origins.append(dev_live_origin_alt)

# Si `allow_origins` contiene '*', no podemos usar credentials true de forma segura.
allow_credentials_flag = False if allow_origins == ["*"] else True

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=allow_credentials_flag,
    allow_methods=["*"],
    allow_headers=["*"],
)

print(f"CORS allow_origins={allow_origins}, allow_credentials={allow_credentials_flag}")

# ============================================================================
# MODELOS DE DATOS (usando Pydantic)
# ============================================================================

class Product(BaseModel):
    name: str = Field(..., min_length=1, description="Nombre de la clase")
    price: float = Field(default=0.0, description="Precio / costo asociado a la clase")
    is_offer: bool = Field(default=False, description="Indica si la clase está en oferta")
    partials: List[Dict[str, Any]] = Field(default_factory=list, description="Lista de parciales")

class ProductResponse(Product):
    item_id: int = Field(..., description="ID único de la clase")
    owner: str = Field(..., description="Usuario propietario (username)")

class ProductsListResponse(BaseModel):
    total: int = Field(..., description="Cantidad total de clases")
    items: List[ProductResponse] = Field(..., description="Lista de clases")

# ============================================================================
# MODELOS Y LÓGICA DE AUTENTICACIÓN
# ============================================================================

class UserBase(BaseModel):
    username: str = Field(..., min_length=3, description="Nombre de usuario")
    email: EmailStr = Field(..., description="Correo electrónico")
    profile_image: Optional[str] = Field(default=None, description="Imagen de perfil en base64")

class UserCreate(UserBase):
    password: str = Field(..., min_length=6, description="Contraseña")

class UserResponse(UserBase):
    is_admin: bool = Field(default=False)

class LoginRequest(BaseModel):
    email: EmailStr = Field(..., description="Correo electrónico")
    password: str = Field(..., description="Contraseña")

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=3)
    password: Optional[str] = Field(None, min_length=6)
    profile_image: Optional[str] = Field(default=None, description="Imagen de perfil en base64")

# Almacenamiento en memoria
users_store: Dict[str, Dict] = {}  # Por user_id
email_index: Dict[str, str] = {}  # Email -> user_id
username_index: Dict[str, str] = {}  # Username -> user_id
sessions: Dict[str, str] = {}  # Token -> user_id
products_db: Dict[int, ProductResponse] = {}

# ============================================================================
# FUNCIONES DE HASH Y AUTENTICACIÓN
# ============================================================================

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
    return hmac.compare_digest(provided_hashed, hashed)

def create_user(user: UserCreate, is_admin: bool = False) -> UserResponse:
    username = user.username.lower()
    email = user.email.lower()
    
    # Verificar que el correo no existe
    if email in email_index:
        raise HTTPException(status_code=400, detail="Correo ya registrado")
    
    # Verificar que el nombre de usuario no existe
    if username in username_index:
        raise HTTPException(status_code=400, detail="Nombre de usuario ya existe")

    # Generar UUID único para el usuario
    user_id = str(uuid.uuid4())
    
    password_hash = _hash_password(user.password)
    user_record = {
        "user_id": user_id,
        "username": username,
        "email": email,
        "password_hash": password_hash,
        "is_admin": is_admin
    }
    
    # Guardar en índices por user_id
    users_store[user_id] = user_record
    email_index[email] = user_id
    username_index[username] = user_id
    
    # Crear carpeta con user_id y guardar metadatos
    user_dir = os.path.join(DUMP_DIR, user_id)
    os.makedirs(user_dir, exist_ok=True)
    user_meta_path = os.path.join(user_dir, "user_meta.json")
    with open(user_meta_path, "w", encoding="utf-8") as f:
        json.dump(user_record, f, ensure_ascii=False, indent=2)
    
    return UserResponse(username=username, email=email, is_admin=is_admin)

def authenticate_user(email: str, password: str) -> Optional[Dict]:
    """Autentica un usuario usando email y contraseña."""
    email_key = email.lower()
    user_id = email_index.get(email_key)
    
    if not user_id or user_id not in users_store:
        return None
    
    user = users_store[user_id]
    if not _verify_password(user["password_hash"], password):
        return None
    
    return user

def create_session_for_user(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    sessions[token] = user_id
    return token

def get_user_by_token(token: str) -> Optional[Dict]:
    if token and token.startswith("Bearer "):
        token = token[7:]
    user_id = sessions.get(token)
    if not user_id:
        return None
    return users_store.get(user_id)

# ============================================================================
# FUNCIONES DE PERSISTENCIA
# ============================================================================

def _class_path(user_id: str, item_id: int) -> str:
    return os.path.join(DUMP_DIR, user_id, str(item_id))

def persist_class_to_disk(user_id: str, item_id: int, data: Dict):
    path = _class_path(user_id, item_id)
    os.makedirs(path, exist_ok=True)
    meta_path = os.path.join(path, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({
            "item_id": item_id,
            "name": data.get("name"),
            "price": data.get("price", 0.0),
            "is_offer": data.get("is_offer", False),
            "partials": data.get("partials", []),
            "owner": data.get("owner")
        }, f, ensure_ascii=False, indent=2)
    # Además de meta.json, volcar cada parcial en archivos separados
    try:
        partials = data.get("partials", []) or []
        partials_dir = os.path.join(path, "partials")
        # Limpiar/crear carpeta de parciales
        if os.path.isdir(partials_dir):
            # eliminar archivos antiguos que no estén en la lista actual
            existing = set(os.listdir(partials_dir))
        else:
            os.makedirs(partials_dir, exist_ok=True)
            existing = set()

        written = set()
        def _safe_filename(name: str) -> str:
            # Simple sanitizer para nombres de archivo
            safe = name.replace(os.sep, "_").strip()
            safe = safe.replace(" ", "_")
            # eliminar caracteres no alfanuméricos básicos
            safe = ''.join(c for c in safe if (c.isalnum() or c in ('_', '-')))
            if not safe:
                safe = f"partial_{secrets.token_hex(4)}"
            return safe

        for p in partials:
            pname = str(p.get("name") or p.get("id") or "partial")
            fname = _safe_filename(pname) + ".json"
            ppath = os.path.join(partials_dir, fname)
            try:
                with open(ppath, "w", encoding="utf-8") as pf:
                    json.dump(p, pf, ensure_ascii=False, indent=2)
                written.add(fname)
            except Exception:
                # si no se puede escribir un parcial concreto, continuar
                continue

        # eliminar archivos obsoletos
        for leftover in existing - written:
            try:
                os.remove(os.path.join(partials_dir, leftover))
            except Exception:
                pass
    except Exception as e:
        # No queremos que un fallo en el volcado de parciales impida que la API funcione
        print(f"Advertencia: error guardando parciales en disco: {e}")

def remove_class_from_disk(user_id: str, item_id: int):
    """Elimina una clase específica del disco."""
    path = _class_path(user_id, item_id)
    if os.path.isdir(path):
        shutil.rmtree(path)

def load_dumpdata_into_memory():
    """Carga clases y usuarios existentes al iniciar."""
    products_db.clear()
    users_store.clear()
    email_index.clear()
    username_index.clear()
    
    if not os.path.isdir(DUMP_DIR):
        return
    
    # Cargar usuarios (cada directorio es un user_id)
    for user_id_dir in os.listdir(DUMP_DIR):
        user_path = os.path.join(DUMP_DIR, user_id_dir)
        if not os.path.isdir(user_path):
            continue
        
        user_meta_path = os.path.join(user_path, "user_meta.json")
        if os.path.isfile(user_meta_path):
            try:
                with open(user_meta_path, "r", encoding="utf-8") as f:
                    user_data = json.load(f)
                
                # Usar el user_id del archivo o el nombre del directorio
                user_id = user_data.get("user_id") or user_id_dir
                
                # Asegurar que user_id está en el diccionario
                if "user_id" not in user_data:
                    user_data["user_id"] = user_id
                
                users_store[user_id] = user_data
                email_index[user_data["email"].lower()] = user_id
                username_index[user_data["username"].lower()] = user_id
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Error cargando usuario de {user_id_dir}: {e}")
                continue
        
        # Cargar clases del usuario
        for item_id_str in os.listdir(user_path):
            if item_id_str == "user_meta.json":
                continue
            try:
                item_id = int(item_id_str)
                meta_path = os.path.join(user_path, item_id_str, "meta.json")
                if os.path.isfile(meta_path):
                    with open(meta_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    products_db[item_id] = ProductResponse(**data)
            except (ValueError, json.JSONDecodeError, KeyError) as e:
                print(f"Error cargando clase {item_id_str}: {e}")
                continue

# Cargar al inicio
load_dumpdata_into_memory()

# ============================================================================
# ENDPOINTS: ITEMS (CLASES)
# ============================================================================

@app.get("/")
async def root():
    return {"message": "API de Clases - FastAPI"}

@app.get("/items/", response_model=ProductsListResponse)
async def get_all_products(authorization: Optional[str] = Header(None)):
    user = get_user_by_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="No autorizado")
    
    user_items = [p for p in products_db.values() if p.owner == user["username"]]
    return ProductsListResponse(total=len(user_items), items=user_items)

@app.get("/items/{item_id}", response_model=ProductResponse)
async def get_product(
    item_id: int,
    authorization: Optional[str] = Header(None),
    q: Optional[str] = Query(None)
):
    user = get_user_by_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="No autorizado")
    
    if item_id not in products_db:
        raise HTTPException(status_code=404, detail="Clase no encontrada")
    
    product = products_db[item_id]
    if product.owner != user["username"]:
        raise HTTPException(status_code=403, detail="No tienes acceso a esta clase")
    
    return product

@app.put("/items/{item_id}", response_model=ProductResponse)
async def create_or_update_product(
    item_id: int,
    product: Product,
    authorization: Optional[str] = Header(None)
):
    user = get_user_by_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="No autorizado")
    
    response = ProductResponse(
        item_id=item_id,
        name=product.name,
        price=product.price,
        is_offer=product.is_offer,
        partials=product.partials,
        owner=user["username"]
    )
    products_db[item_id] = response
    persist_class_to_disk(user["user_id"], item_id, response.dict())
    return response

@app.delete("/items/{item_id}")
async def delete_product(item_id: int):
    """
    Eliminación simple (compatible con 'servidor funcional').
    No requiere autenticación: elimina la clase del diccionario en memoria.
    """
    if item_id not in products_db:
        raise HTTPException(status_code=404, detail=f"Clase con ID {item_id} no encontrada")

    # Eliminar y devolver confirmación
    deleted = products_db.pop(item_id)
    # Intentar eliminar en disco si existe la estructura (no crítico)
    try:
        # Si no hay owner/estructura en el registro, skip
        owner = getattr(deleted, 'owner', None)
        if owner:
            # Buscar user_id en users_store por username (si existe)
            user_id = None
            for uid, u in users_store.items():
                if u.get('username') == owner:
                    user_id = uid
                    break
            if user_id:
                try:
                    remove_class_from_disk(user_id, item_id)
                except Exception:
                    pass
    except Exception:
        pass

    return {"message": f"Clase '{deleted.name}' eliminada", "item_id": item_id}

# ============================================================================
# ENDPOINTS: PARCIALES
# ============================================================================

@app.post("/items/{item_id}/partials")
async def add_partial(
    item_id: int,
    partial: Dict[str, Any],
    authorization: Optional[str] = Header(None)
):
    user = get_user_by_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="No autorizado")
    
    if item_id not in products_db:
        raise HTTPException(status_code=404, detail="Clase no encontrada")
    
    product = products_db[item_id]
    if product.owner != user["username"]:
        raise HTTPException(status_code=403, detail="No tienes acceso a esta clase")
    
    partial_name = partial.get("name")
    if not partial_name:
        raise HTTPException(status_code=400, detail="El parcial debe tener un nombre")
    
    existing_idx = next((i for i, p in enumerate(product.partials) if p.get("name") == partial_name), None)
    if existing_idx is not None:
        product.partials[existing_idx].update(partial)
    else:
        product.partials.append(partial)
    
    persist_class_to_disk(user["user_id"], item_id, product.dict())
    return {"message": "Parcial guardado", "partial": partial}

@app.delete("/items/{item_id}/partials/{partial_name}")
async def delete_partial(
    item_id: int,
    partial_name: str,
    authorization: Optional[str] = Header(None)
):
    user = get_user_by_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="No autorizado")
    
    if item_id not in products_db:
        raise HTTPException(status_code=404, detail="Clase no encontrada")
    
    product = products_db[item_id]
    if product.owner != user["username"]:
        raise HTTPException(status_code=403, detail="No tienes acceso a esta clase")
    
    product.partials = [p for p in product.partials if p.get("name") != partial_name]
    persist_class_to_disk(user["user_id"], item_id, product.dict())
    return {"message": "Parcial eliminado"}

# ============================================================================
# ENDPOINTS: ACTIVIDADES
# ============================================================================

@app.post("/items/{item_id}/partials/{partial_name}/activities")
async def add_activity(
    item_id: int,
    partial_name: str,
    activity: Dict[str, Any],
    authorization: Optional[str] = Header(None)
):
    user = get_user_by_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="No autorizado")
    
    if item_id not in products_db:
        raise HTTPException(status_code=404, detail="Clase no encontrada")
    
    product = products_db[item_id]
    if product.owner != user["username"]:
        raise HTTPException(status_code=403, detail="No tienes acceso a esta clase")
    
    partial = next((p for p in product.partials if p.get("name") == partial_name), None)
    if not partial:
        raise HTTPException(status_code=404, detail="Parcial no encontrado")
    
    if "activities" not in partial:
        partial["activities"] = []
    
    activity_id = len(partial["activities"])
    activity_copy = activity.copy()
    activity_copy["id"] = activity_id
    partial["activities"].append(activity_copy)
    
    persist_class_to_disk(user["user_id"], item_id, product.dict())
    return {"id": activity_id, "activity": activity_copy}

@app.delete("/items/{item_id}/partials/{partial_name}/activities/{activity_idx}")
async def delete_activity(
    item_id: int,
    partial_name: str,
    activity_idx: int,
    authorization: Optional[str] = Header(None)
):
    user = get_user_by_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="No autorizado")
    
    if item_id not in products_db:
        raise HTTPException(status_code=404, detail="Clase no encontrada")
    
    product = products_db[item_id]
    if product.owner != user["username"]:
        raise HTTPException(status_code=403, detail="No tienes acceso a esta clase")
    
    partial = next((p for p in product.partials if p.get("name") == partial_name), None)
    if not partial:
        raise HTTPException(status_code=404, detail="Parcial no encontrado")
    
    if "activities" not in partial or activity_idx >= len(partial["activities"]):
        raise HTTPException(status_code=404, detail="Actividad no encontrada")
    
    partial["activities"].pop(activity_idx)
    persist_class_to_disk(user["user_id"], item_id, product.dict())
    return {"message": "Actividad eliminada"}

# ============================================================================
# ENDPOINTS: AUTENTICACIÓN
# ============================================================================

@app.post("/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(user: UserCreate):
    user_response = create_user(user)
    user_id = username_index[user.username.lower()]
    token = create_session_for_user(user_id)
    return TokenResponse(access_token=token, user=user_response)

@app.post("/auth/login", response_model=TokenResponse)
async def login(credentials: LoginRequest):
    user = authenticate_user(credentials.email, credentials.password)
    if not user:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    token = create_session_for_user(user["user_id"])
    return TokenResponse(
        access_token=token,
        user=UserResponse(username=user["username"], email=user["email"], is_admin=user["is_admin"])
    )

@app.get("/auth/check/{username}")
async def check_username(username: str):
    exists = username.lower() in username_index
    return {"username": username, "exists": exists}

@app.get("/auth/me", response_model=UserResponse)
async def me(authorization: Optional[str] = Header(None)):
    user = get_user_by_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="No autorizado")
    return UserResponse(username=user["username"], email=user["email"], is_admin=user["is_admin"], profile_image=user.get("profile_image"))

@app.patch("/auth/me", response_model=UserResponse)
async def update_account(update: UserUpdate, authorization: Optional[str] = Header(None)):
    user = get_user_by_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="No autorizado")
    
    user_id = user["user_id"]
    
    if update.username:
        new_username = update.username.lower()
        old_username = user["username"].lower()
        
        if new_username != old_username and new_username in username_index:
            raise HTTPException(status_code=400, detail="Nombre de usuario ya existe")
        
        # Actualizar índice de nombres de usuario
        if old_username in username_index:
            del username_index[old_username]
        username_index[new_username] = user_id
        user["username"] = new_username
    
    if update.password:
        user["password_hash"] = _hash_password(update.password)
    
    if update.profile_image is not None:
        user["profile_image"] = update.profile_image
    
    # Guardar metadatos actualizados
    user_meta_path = os.path.join(DUMP_DIR, user_id, "user_meta.json")
    with open(user_meta_path, "w", encoding="utf-8") as f:
        json.dump(user, f, ensure_ascii=False, indent=2)
    
    return UserResponse(username=user["username"], email=user["email"], is_admin=user["is_admin"], profile_image=user.get("profile_image"))

@app.delete("/auth/me")
async def delete_account(authorization: Optional[str] = Header(None)):
    user = get_user_by_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="No autorizado")
    
    user_id = user["user_id"]
    email = user["email"].lower()
    username = user["username"].lower()
    
    # Eliminar clases del usuario PRIMERO
    products_db_copy = dict(products_db)
    for item_id, product in products_db_copy.items():
        if product.owner == user["username"]:
            try:
                remove_class_from_disk(user_id, item_id)
            except Exception as e:
                print(f"Advertencia al eliminar clase {item_id}: {e}")
            del products_db[item_id]
    
    # Eliminar carpeta del usuario completamente con manejo robusto
    user_dir = os.path.join(DUMP_DIR, user_id)
    if os.path.isdir(user_dir):
        try:
            import stat
            import time
            
            # Primero intenta eliminación normal
            try:
                shutil.rmtree(user_dir)
            except PermissionError:
                # Si falla por permisos, cambia permisos recursivamente
                for root, dirs, files in os.walk(user_dir, topdown=False):
                    for name in files:
                        path = os.path.join(root, name)
                        try:
                            os.chmod(path, stat.S_IWUSR | stat.S_IRUSR)
                            os.remove(path)
                        except Exception as e:
                            print(f"No se pudo eliminar archivo {path}: {e}")
                    
                    for name in dirs:
                        path = os.path.join(root, name)
                        try:
                            os.chmod(path, stat.S_IWUSR | stat.S_IRUSR | stat.S_IXUSR)
                        except Exception as e:
                            print(f"No se pudo cambiar permisos de {path}: {e}")
                
                # Intenta eliminar directorios después
                for root, dirs, files in os.walk(user_dir, topdown=False):
                    for name in dirs:
                        path = os.path.join(root, name)
                        try:
                            os.rmdir(path)
                        except Exception as e:
                            print(f"No se pudo eliminar directorio {path}: {e}")
                
                # Intenta eliminar la carpeta raíz
                try:
                    os.rmdir(user_dir)
                except Exception as e:
                    print(f"No se pudo eliminar carpeta raíz {user_dir}: {e}")
        except Exception as e:
            print(f"Error al eliminar carpeta {user_dir}: {e}")
            # Continúa aunque falle la eliminación de carpeta
    
    # Eliminar de índices
    if user_id in users_store:
        del users_store[user_id]
    if email in email_index:
        del email_index[email]
    if username in username_index:
        del username_index[username]
    
    return {"message": "Cuenta eliminada"}

# ============================================================================
# PUNTO DE ENTRADA
# ============================================================================

if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    reload_env = os.getenv("RELOAD", "true").lower()
    reload_flag = reload_env in ("1", "true", "yes", "y")

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=reload_flag
    )
