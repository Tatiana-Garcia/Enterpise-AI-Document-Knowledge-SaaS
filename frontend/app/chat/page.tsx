// frontend/app/chat/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { askRAG } from '@/lib/api';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    sources?: { title: string; similarity: string }[];
}

export default function ChatPage() {
    const [question, setQuestion] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) router.push('/login');
    }, [router]);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!question.trim() || loading) return;

        const userQuestion = question;
        setQuestion('');
        setMessages((prev) => [...prev, { role: 'user', content: userQuestion }]);
        setLoading(true);

        try {
            const token = localStorage.getItem('token');
            if (!token) return router.push('/login');

            const data = await askRAG(userQuestion, token);
            setMessages((prev) => [
                ...prev,
                {
                    role: 'assistant',
                    content: data.answer || 'No se obtuvo respuesta',
                    sources: data.sources || [],
                },
            ]);
        } catch (err) {
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: 'Error al conectar con el servidor de IA.' },
            ]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-950 text-white flex flex-col">
            <header className="bg-gray-900 border-b border-gray-800 p-4 flex justify-between items-center">
                <h1 className="text-lg font-bold">Enterprise AI Chat (Llama 3 + pgvector)</h1>
                <button 
                    onClick={() => router.push('/dashboard')}
                    className="bg-gray-800 hover:bg-gray-700 text-sm px-4 py-2 rounded transition font-medium"
                >
                    Volver al Dashboard
                </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 max-w-3xl w-full mx-auto space-y-4">
                {messages.length === 0 && (
                    <div className="text-center text-gray-500 mt-20">
                        <p className="text-xl mb-2">¡Hola! Pregúntale lo que quieras a tus documentos corporativos.</p>
                        <p className="text-sm">El sistema buscará los fragmentos relevantes y Llama 3 responderá de forma privada.</p>
                    </div>
                )}

                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-xl p-4 rounded-xl ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-900 border border-gray-800 text-gray-200'}`}>
                            <p className="whitespace-pre-wrap">{msg.content}</p>

                            {msg.sources && msg.sources.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-gray-400">
                                    <span className="font-semibold text-gray-300">Fuentes consultadas:</span>
                                    <ul className="mt-1 space-y-1">
                                        {msg.sources.map((src, i) => (
                                            <li key={i}>
                                                📄 {src.title} (Similitud: {(Number(src.similarity) * 100).toFixed(1)}%)
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {loading && (
                    <div className="flex items-start">
                        <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl text-gray-400 animate-pulse text-sm">
                            Pensando respuesta con Llama 3...
                        </div>
                    </div>
                )}
            </div>

            <form onSubmit={handleSend} className="bg-gray-900 border-t border-gray-800 p-4">
                <div className="max-w-3xl mx-auto flex gap-2">
                    <input 
                        type="text"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="Escribe tu pregunta sobre los documentos..."
                        className="flex-1 bg-gray-800 border border-gray-700 rounded p-3 text-white focus:outline-none focus:border-indigo-500 text-sm"
                    />
                    <button 
                        type="submit"
                        disabled={loading}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition px-6 py-3 rounded font-medium text-white text-sm"
                    >
                        Enviar
                    </button>
                </div>
            </form>
        </div>
    );
}