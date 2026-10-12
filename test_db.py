import os
import psycopg2  # pyright: ignore[reportMissingModuleSource]
from dotenv import load_dotenv  # pyright: ignore[reportMissingImports]

load_dotenv()

try:
    connection = psycopg2.connect(
        host="localhost",
        database=os.getenv("mydatabase"),
        user=os.getenv("myuser"),
        password=os.getenv("mypassword"),
        port="5432"
    )
    cursor = connection.cursor()
    cursor.execute("SELECT version();")
    db_version = cursor.fetchone()
    print(f"¡Conexión exitosa! Versión de PostgreSQL: {db_version[0]}")
    cursor.close()
    connection.close()
except Exception as error:
    print(f"Error al conectar a la base de datos: {error}")