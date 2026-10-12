// frontend/lib/api.ts
const API_URL = 'http://localhost:3000/api';

// frontend/lib/api.ts (Añade esta función junto a loginUser)
export async function registerUser(name: string, email: string, password: string) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api'}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
    });
    return res.json();
}

export async function loginUser(email: string, password: string) {
    const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    return res.json();
}

export async function getPresignedUrl(fileName: string, fileType: string, token: string) {
    const res = await fetch(`${API_URL}/documents/presigned-url`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ fileName, fileType }),
    });
    return res.json();
}

export async function processPdf(fileKey: string, title: string, token: string) {
    const res = await fetch(`${API_URL}/documents/process-pdf`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ fileKey, title }),
    });
    return res.json();
}

export async function askRAG(question: string, token: string) {
    const res = await fetch(`${API_URL}/documents/ask`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ question }),
    });
    return res.json();
}