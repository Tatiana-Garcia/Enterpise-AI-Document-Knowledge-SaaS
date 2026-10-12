// frontend/app/dashboard/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getPresignedUrl, processPdf } from '@/lib/api';

export default function DashboardPage() {
    const [file, setFile] = useState<File | null>(null);
    const [title, setTitle] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const router = useRouter();

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) {
            router.push('/login');
        }
    }, [router]);

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) return;

        setLoading(true);
        setMessage('Generando URL firmada para S3...');

        try {
            const token = localStorage.getItem('token');
            if (!token) return router.push('/login');

            // 1. Pedir URL firmada al backend
            const presignedData = await getPresignedUrl(file.name, file.type, token);
            if (!presignedData.uploadUrl) {
                throw new Error(presignedData.error || 'Error al obtener URL firmada');
            }

            setMessage('Subiendo PDF directamente a AWS S3...');
            // 2. Subir el archivo binario usando PUT a la URL firmada de S3
            const uploadRes = await fetch(presignedData.uploadUrl, {
                method: 'PUT',
                headers: { 'Content-Type': file.type },
                body: file,
            });

            if (!uploadRes.ok) {
                throw new Error('Fallo al subir el archivo físico a AWS S3');
            }

            setMessage('Procesando PDF, dividiendo en chunks y vectorizando localmente...');
            // 3. Ejecutar el pipeline ETL en el backend
            const processRes = await processPdf(presignedData.fileKey, title || file.name, token);
            
            if (processRes.message) {
                setMessage(`¡Éxito! ${processRes.message} (${processRes.totalChunks} chunks guardados).`);
            } else {
                setMessage(processRes.error || 'Error al procesar el PDF');
            }
        } catch (err: any) {
            setMessage(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-950 text-white p-8">
            <div className="max-w-xl mx-auto bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-xl">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-xl font-bold">Panel de Carga S3 + ETL</h1>
                    <button 
                        onClick={() => router.push('/chat')}
                        className="bg-indigo-600 hover:bg-indigo-500 text-sm px-4 py-2 rounded transition font-medium"
                    >
                        Ir al Chat RAG 🤖
                    </button>
                </div>

                {message && (
                    <div className="bg-gray-800 border border-gray-700 p-3 rounded mb-4 text-sm text-indigo-300">
                        {message}
                    </div>
                )}

                <form onSubmit={handleUpload} className="space-y-4">
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Título del Documento</label>
                        <input 
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2.5 text-white focus:outline-none focus:border-indigo-500"
                            placeholder="Ej: Manual de Seguridad 2026"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Seleccionar archivo PDF</label>
                        <input 
                            type="file"
                            accept="application/pdf"
                            onChange={(e) => setFile(e.target.files?.[0] || null)}
                            className="w-full text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition text-white font-medium p-2.5 rounded shadow"
                    >
                        {loading ? 'Procesando pipeline...' : 'Subir y Procesar PDF'}
                    </button>
                </form>
            </div>
        </div>
    );
}