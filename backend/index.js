const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createClient } = require('redis');
require('dotenv').config();

const path = require('path');

// Esto le dice: "Busca el archivo .env subiendo un nivel, en la raíz del proyecto"
require('dotenv').config({ path: path.join(__dirname, '../.env') });


const pdfParse = require('pdf-parse');
const { GetObjectCommand } = require('@aws-sdk/client-s3');


const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Configurar el cliente de AWS S3
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

// Inicializar cliente de Redis (apunta al contenedor de Docker)
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;

const redisClient = createClient({
    url: `redis://${redisHost}:${redisPort}`
});

const app = express();
app.use(cors({
    origin: 'http://localhost:3001',
    credentials: true
}));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_super_segura';

redisClient.on('error', (err) => console.error('❌ Error en Redis Client:', err));

(async () => {
    await redisClient.connect();
    console.log('🔴 Conectado a Redis exitosamente.');
})();

// ==========================================
// MIDDLEWARE DE RATE LIMITING CON REDIS
// ==========================================
const rateLimiter = async (req, res, next) => {
    try {
        // Identificador único (usamos la IP del cliente o su ID de usuario si está autenticado)
        const identifier = req.ip || 'global_client';
        const key = `rate_limit:${identifier}`;

        // Contar peticiones en una ventana de tiempo (ej. máximo 10 peticiones por minuto)
        const requests = await redisClient.incr(key);

        if (requests === 1) {
            // Establecer expiración de 60 segundos en la primera petición
            await redisClient.expire(key, 60);
        }

        if (requests > 10) {
            return res.status(429).json({
                error: 'Demasiadas solicitudes. Has excedido el límite de 10 peticiones por minuto.',
                retry_after_seconds: await redisClient.ttl(key)
            });
        }

        next();
    } catch (err) {
        // Si Redis falla por alguna razón, no bloqueamos la petición principal del usuario
        console.error('Error en Rate Limiter:', err);
        next();
    }
};


// ==========================================
// FUNCIÓN UTILITARIA DE CHUNKING (DIVISIÓN DE TEXTO)
// ==========================================
function chunkText(text, chunkSize = 500, overlap = 50) {
    const chunks = [];
    let startIndex = 0;

    // Eliminar saltos de línea excesivos y espacios dobles
    const cleanedText = text.replace(/\s+/g, ' ').trim();

    while (startIndex < cleanedText.length) {
        let endIndex = startIndex + chunkSize;
        let chunk = cleanedText.slice(startIndex, endIndex);

        // Ajustar el final para no cortar palabras a la mitad
        if (endIndex < cleanedText.length) {
            const lastSpace = chunk.lastIndexOf(' ');
            if (lastSpace > 0) {
                chunk = chunk.slice(0, lastSpace);
                endIndex = startIndex + lastSpace;
            }
        }

        chunks.push(chunk.trim());
        startIndex = endIndex - overlap; // Solapamiento entre chunks
    }

    return chunks;
}

// Configuración de la conexión a PostgreSQL usando las variables del archivo .env
const pool = new Pool({
    user: process.env.DB_USER || process.env.myuser,
    host: process.env.DB_HOST || 'localhost', 
    database: process.env.DB_NAME || process.env.mydatabase,
    password: process.env.DB_PASSWORD || process.env.mypassword,
    port: process.env.DB_PORT || 5432,
});

// Función para inicializar la base de datos (Crear tabla users si no existe)
async function initDB() {
    const usersQuery = `
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(150) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(20) CHECK (role IN ('Admin', 'Editor', 'Lector')) DEFAULT 'Lector',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    try {
        // 1. Borramos la tabla de documentos vieja por completo (para limpiar los 1536d)
        //await pool.query('DROP TABLE IF EXISTS documents CASCADE;');
        //console.log('🗑️ Tabla "documents" anterior eliminada.');

        // 2. Creamos la tabla nueva con la dimensión correcta de Ollama (768)
        const docsQuery = `
            CREATE TABLE IF NOT EXISTS documents (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                embedding vector(768), 
                uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        await pool.query(usersQuery);
        await pool.query(docsQuery);
        console.log('📦 Tablas "users" y "documents" (768d) creadas exitosamente.');
    } catch (err) {
        console.error('Error al inicializar las tablas:', err.message);
    }
}

// ==========================================
// ENDPOINT: DESCARGAR DE S3, PARSEAR, DIVIDIR Y VECTORIZAR
// ==========================================
app.post('/api/documents/process-pdf', verifyToken, checkRole(['Admin', 'Editor']), async (req, res) => {
    const { fileKey, title } = req.body;

    if (!fileKey || !title) {
        return res.status(400).json({ error: 'El fileKey (ruta en S3) y el título son obligatorios.' });
    }

    try {
        const userId = req.user.id;

        // 1. Descargar el archivo PDF desde AWS S3 como Buffer
        const getObjectParams = {
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: fileKey,
        };
        const s3Response = await s3Client.send(new GetObjectCommand(getObjectParams));
        const streamToBuffer = async (stream) => {
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            return Buffer.concat(chunks);
        };
        const pdfBuffer = await streamToBuffer(s3Response.Body);

        // 👀 Vamos a ver qué trae exactamente pdfParse en tu consola
        console.log("🔍 TIPO DE PDF-PARSE:", typeof pdfParse);
        console.log("🔍 CONTENIDO DE PDF-PARSE:", pdfParse);

        const pdfData = await pdfParse(pdfBuffer);
        const extractedText = pdfData.text;

        if (!extractedText || extractedText.trim().length === 0) {
            return res.status(400).json({ error: 'El PDF descargado no contiene texto extraíble.' });
        }

        // 3. Dividir el texto en fragmentos lógicos (Chunking)
        const textChunks = chunkText(extractedText, 500, 50);
        console.log(`📄 Documento "${title}" dividido en ${textChunks.length} chunks.`);

        // 4. Guardar cada chunk con su embedding vectorial en PostgreSQL
        let savedCount = 0;
        for (const chunkContent of textChunks) {
            // Generar embedding vectorial con Ollama
            const embeddingResponse = await openai.embeddings.create({
                model: "nomic-embed-text",
                input: chunkContent,
            });
            const queryEmbedding = embeddingResponse.data[0].embedding;
            const vectorString = `[${queryEmbedding.join(',')}]`;

            const query = `
                INSERT INTO documents (title, content, embedding, uploaded_by)
                VALUES ($1, $2, $3, $4);
            `;
            await pool.query(query, [`${title} (Parte ${savedCount + 1})`, chunkContent, vectorString, userId]);
            savedCount++;
        }

        res.status(201).json({
            message: 'PDF procesado, dividido en chunks y vectorizado localmente con éxito',
            totalChunks: textChunks.length,
            fileKey: fileKey
        });

    } catch (err) {
        console.error('Error al procesar PDF de S3:', err);
        res.status(500).json({ error: 'Error al procesar el PDF desde AWS S3', details: err.message });
    }
});

// Ruta de prueba para verificar la API y la Base de Datos
app.get('/test_db', async (req, res) => {
    try {
        const result = await pool.query('SELECT version();');
        res.json({
            message: '¡Conexión exitosa desde Node.js a PostgreSQL!',
            db_version: result.rows[0].version
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al conectar a la base de datos', details: err.message });
    }
});

// 1. ENDPOINT DE REGISTRO
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: name, email, password' });
    }

    try {
        // Encriptar la contraseña con bcrypt (10 rondas de salt)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Validar rol (si no se envía o no es válido, por defecto será 'Lector')
        const userRole = ['Admin', 'Editor', 'Lector'].includes(role) ? role : 'Lector';

        const query = `
            INSERT INTO users (name, email, password, role)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, email, role, created_at;
        `;
        const values = [name, email, hashedPassword, userRole];
        const result = await pool.query(query, values);

        res.status(201).json({
            message: 'Usuario registrado con éxito',
            user: result.rows[0]
        });
    } catch (err) {
        if (err.code === '23505') { // Código de error de Postgres para duplicados (Unique violation)
            return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
        }
        res.status(500).json({ error: 'Error en el servidor', details: err.message });
    }
});

// 2. ENDPOINT DE LOGIN
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Por favor, ingresa email y contraseña' });
    }

    try {
        // Buscar el usuario por email
        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const user = userResult.rows[0];

        // Validar la contraseña comparándola con el hash guardado
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Generar un JSON Web Token (JWT) que expire en 8 horas
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            message: 'Login exitoso',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Error en el servidor', details: err.message });
    }
});

// Middleware para verificar el Token JWT
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato: Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
    }

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified; // Guardamos los datos del usuario en la petición
        next();
    } catch (err) {
        res.status(403).json({ error: 'Token inválido o expirado.' });
    }
}

// Middleware para verificar Roles (Ej: Admin, Editor)
function checkRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'No tienes permisos suficientes para realizar esta acción.' });
        }
        next();
    };
}

// Ejemplo de Ruta Protegida exclusiva para Admins
app.get('/api/admin/dashboard', verifyToken, checkRole(['Admin']), (req, res) => {
    res.json({
        message: 'Bienvenido al panel de administración protegido',
        admin_data: req.user
    });
});

// ENDPOINT PARA CREAR/SUBIR UN DOCUMENTO (Solo Admin y Editor)
app.post('/api/documents', verifyToken, checkRole(['Admin', 'Editor']), async (req, res) => {
    const { title, content } = req.body;

    if (!title || !content) {
        return res.status(400).json({ error: 'El título y el contenido del documento son obligatorios.' });
    }

    try {
        const userId = req.user.id;

        // Generar embedding real de 768 dimensiones con Ollama (nomic-embed-text)
        const embeddingResponse = await openai.embeddings.create({
            model: "nomic-embed-text",
            input: content,
        });
        const queryEmbedding = embeddingResponse.data[0].embedding;
        const vectorString = `[${queryEmbedding.join(',')}]`;

        const query = `
            INSERT INTO documents (title, content, embedding, uploaded_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id, title, uploaded_by, created_at;
        `;
        const values = [title, content, vectorString, userId];
        const result = await pool.query(query, values);

        res.status(201).json({
            message: 'Documento guardado y vectorizado localmente con Ollama',
            document: result.rows[0]
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al guardar el documento', details: err.message });
    }
});

// ==========================================
// ENDPOINT DE BÚSQUEDA SEMÁNTICA (RAG)
// ==========================================
app.post('/api/documents/search', verifyToken, async (req, res) => {
    const { query_text } = req.body;

    if (!query_text) {
        return res.status(400).json({ error: 'El texto de búsqueda es obligatorio.' });
    }

    try {
        // Generar embedding de la búsqueda con Ollama
        const embeddingResponse = await openai.embeddings.create({
            model: "nomic-embed-text",
            input: query_text,
        });
        const queryEmbedding = embeddingResponse.data[0].embedding;
        const vectorString = `[${queryEmbedding.join(',')}]`;

        const query = `
            SELECT id, title, content, created_at,
                   (embedding <=> $1) AS distance
            FROM documents
            ORDER BY distance ASC
            LIMIT 3;
        `;
        const result = await pool.query(query, [vectorString]);

        res.json({
            message: 'Búsqueda semántica local realizada con éxito',
            query: query_text,
            results: result.rows
        });
    } catch (err) {
        res.status(500).json({ error: 'Error en búsqueda semántica', details: err.message });
    }
});
const OpenAI = require('openai');

// ==========================================
// ENDPOINT DE SOPORTE INTELIGENTE RAG (LLM + Vectores)
// ==========================================
app.post('/api/support/ask', verifyToken, rateLimiter, async (req, res) => {
    const { question } = req.body;

    if (!question) {
        return res.status(400).json({ error: 'La pregunta es obligatoria.' });
    }

    try {
        // 1. Embedding de la pregunta con Ollama
        const embeddingResponse = await openai.embeddings.create({
            model: "nomic-embed-text",
            input: question,
        });
        const queryEmbedding = embeddingResponse.data[0].embedding;
        const vectorString = `[${queryEmbedding.join(',')}]`;

        // 2. Buscar documentos relevantes en PostgreSQL
        const searchQuery = `
            SELECT id, title, content, (embedding <=> $1) AS distance
            FROM documents
            ORDER BY distance ASC
            LIMIT 3;
        `;
        const searchResult = await pool.query(searchQuery, [vectorString]);
        const relevantDocs = searchResult.rows;

        // 3. Consolidar contexto
        let contextText = "";
        relevantDocs.forEach((doc, index) => {
            contextText += `--- Documento ${index + 1}: ${doc.title} ---\n${doc.content}\n\n`;
        });

        // 4. Generar respuesta con el modelo local Llama 3
        const chatCompletion = await openai.chat.completions.create({
            model: "llama3",
            messages: [
                {
                    role: "system",
                    content: "Eres un asistente de soporte de TI empresarial experto. Responde usando exclusivamente el contexto proporcionado."
                },
                {
                    role: "user",
                    content: `Contexto:\n${contextText}\n\nPregunta: ${question}`
                }
            ],
            temperature: 0.2,
        });

        const aiResponse = chatCompletion.choices[0].message.content;

        res.json({
            question,
            answer: aiResponse,
            sources: relevantDocs.map(d => ({ id: d.id, title: d.title }))
        });

    } catch (err) {
        res.status(500).json({ error: 'Error al procesar con IA local', details: err.message });
    }
});

// ==========================================
// ENDPOINT RAG: BÚSQUEDA INTELIGENTE Y GENERACIÓN CON LLAMA 3
// ==========================================
app.post('/api/documents/ask', verifyToken, async (req, res) => {
    const { question } = req.body;

    if (!question) {
        return res.status(400).json({ error: 'La pregunta es obligatoria.' });
    }

    try {
        // 1. Convertir la pregunta del usuario en un vector con Ollama
        const embeddingResponse = await openai.embeddings.create({
            model: "nomic-embed-text",
            input: question,
        });
        const queryEmbedding = embeddingResponse.data[0].embedding;
        const vectorString = `[${queryEmbedding.join(',')}]`;

        // 2. Buscar los 3 chunks más similares en PostgreSQL usando pgvector
        const searchQuery = `
            SELECT title, content, 1 - (embedding <=> $1) AS similarity
            FROM documents
            ORDER BY embedding <=> $1
            LIMIT 3;
        `;
        const searchResult = await pool.query(searchQuery, [vectorString]);
        const relevantDocs = searchResult.rows;

        if (relevantDocs.length === 0) {
            return res.status(200).json({
                answer: "No encontré documentos relevantes en la base de datos para responder a tu pregunta.",
                sources: []
            });
        }

        // 3. Consolidar el contexto obtenido de los chunks
        let contextText = "";
        relevantDocs.forEach((doc, idx) => {
            contextText += `--- Fragmento ${idx + 1} (${doc.title}) ---\n${doc.content}\n\n`;
        });

        // 4. Enviar contexto y pregunta a Llama 3 para generar la respuesta final
        const completionResponse = await openai.chat.completions.create({
            model: "llama3",
            messages: [
                {
                    role: "system",
                    content: "Eres un asistente de IA corporativo experto. Responde a la pregunta del usuario basándote EXCLUSIVAMENTE en el contexto de los documentos proporcionados a continuación. Si la respuesta no se encuentra en el contexto, indica claramente que los documentos no contienen esa información."
                },
                {
                    role: "user",
                    content: `Contexto de documentos:\n${contextText}\n\nPregunta del usuario: ${question}`
                }
            ],
            temperature: 0.1, // Baja temperatura para respuestas más precisas y objetivas
        });

        const answer = completionResponse.choices[0].message.content;

        // 5. Responder al cliente con la respuesta generada y las fuentes consultadas
        res.status(200).json({
            question,
            answer,
            sources: relevantDocs.map(d => ({ title: d.title, similarity: Number(d.similarity).toFixed(4) }))
        });

    } catch (err) {
        console.error('Error en el pipeline RAG:', err);
        res.status(500).json({ error: 'Error al procesar la consulta inteligente', details: err.message });
    }
});

// Inicializar el cliente de OLLAMA
const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

const openai = new OpenAI({
    baseURL: `${ollamaUrl}/v1`,
    apiKey: 'ollama',
});

app.post('/api/documents/presigned-url', verifyToken, checkRole(['Admin', 'Editor']), async (req, res) => {
    const { fileName, fileType } = req.body;

    if (!fileName || !fileType) {
        return res.status(400).json({ error: 'El nombre del archivo y el tipo (fileType) son obligatorios.' });
    }

    try {
        // Crear una ruta única en S3 para evitar colisiones de nombres
        const uniqueKey = `documents/${Date.now()}-${fileName}`;

        const command = new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: uniqueKey,
            ContentType: fileType,
        });

        // Generar URL firmada con vigencia de 5 minutos (300 segundos)
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

        res.json({
            message: 'URL firmada generada con éxito',
            uploadUrl: presignedUrl,
            fileKey: uniqueKey // Guardaremos esta key en la base de datos después para ubicar el archivo en S3
        });

    } catch (err) {
        res.status(500).json({ error: 'Error al generar la URL firmada de S3', details: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    await initDB();
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});