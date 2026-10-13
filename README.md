# Enterpise-AI-Document-Knowledge-SaaS
<img width="1024" height="559" alt="image" src="https://github.com/user-attachments/assets/194a746f-722b-4db0-aa06-9d9ff8dd8465" />


`
docker compose up -d
docker ps
docker logs postgres_container
docker compose down
docker compose restart backend
docker logs saas_backend --tail 20

docker exec -it postgres_container psql -U mi_usuario_postgres -d enterprise_ai_db
docker exec -it postgres_container psql -U mi_usuario_postgres -d enterprise_ai_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
docker exec -it postgres_container psql -U mi_usuario_postgres -d enterprise_ai_db -c "\dt"
docker exec -it postgres_container psql -U mi_usuario_postgres -d enterprise_ai_db -c "\d users"

c:\python314\python.exe -m pip install psycopg2-binary python-dotenv

Dependecias
npm install express dotenv pg redis cors bcrypt jsonwebtoken
npm install -D nodemon
npm install redis
npm install pdf-parse
npm install pdf-parse@1.1.1
npm install cors  (\backend)
`
