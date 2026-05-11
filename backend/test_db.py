import os
import sys
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

sys.path.insert(0, os.path.dirname(__file__))
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

try:
    print(f"Attempting to connect to: {DATABASE_URL}")
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1"))
        print("Connection successful! DB replied:", result.scalar())
except Exception as e:
    print("Connection failed:", e)
