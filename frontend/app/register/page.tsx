// frontend/app/register/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { registerUser } from '@/lib/api';

export default function RegisterPage() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const router = useRouter();

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        try {
            const data = await registerUser(name, email, password);
            if (data.token) {
                // Guardamos el JWT y redirigimos al dashboard
                localStorage.setItem('token', data.token);
                router.push('/dashboard');
            } else {
                setError(data.error || data.message || 'Error al registrar usuario');
            }
        } catch (err) {
            setError('Error al conectar con el servidor backend');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
            <div className="bg-gray-900 p-8 rounded-xl shadow-2xl w-full max-w-md border border-gray-800">
                <h1 className="text-2xl font-bold mb-2 text-center">Enterprise AI SaaS</h1>
                <p className="text-gray-400 text-sm mb-6 text-center">Crea tu cuenta de administrador</p>

                {error && <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded mb-4 text-sm">{error}</div>}

                <form onSubmit={handleRegister} className="space-y-4">
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Nombre completo</label>
                        <input 
                            type="text" 
                            value={name} 
                            onChange={(e) => setName(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2.5 text-white focus:outline-none focus:border-indigo-500"
                            placeholder="Tu Nombre"
                            required 
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Correo electrónico</label>
                        <input 
                            type="email" 
                            value={email} 
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2.5 text-white focus:outline-none focus:border-indigo-500"
                            placeholder="admin@enterprise.com"
                            required 
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Contraseña</label>
                        <input 
                            type="password" 
                            value={password} 
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2.5 text-white focus:outline-none focus:border-indigo-500"
                            placeholder="••••••••"
                            required 
                        />
                    </div>
                    <button 
                        type="submit" 
                        className="w-full bg-indigo-600 hover:bg-indigo-500 transition text-white font-medium p-2.5 rounded shadow"
                    >
                        Registrarse
                    </button>
                </form>

                <p className="text-center text-sm text-gray-400 mt-6">
                    ¿Ya tienes una cuenta?{' '}
                    <Link href="/login" className="text-indigo-400 hover:underline">
                        Inicia sesión aquí
                    </Link>
                </p>
            </div>
        </div>
    );
}