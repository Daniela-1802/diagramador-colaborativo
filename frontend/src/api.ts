/// <reference types="vite/client" />

export const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

export const apiUrl = (path: string): string => `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
