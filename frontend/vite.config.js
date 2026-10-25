import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
// Dev: proxy /api to the live backend. Production: vercel.json does the same rewrite.
export default defineConfig({plugins:[react()],server:{proxy:{'/api':{target:'https://trust-vault-nq0f.onrender.com',changeOrigin:true,secure:true,rewrite:p=>p.replace(/^\/api/,'')}}}})
