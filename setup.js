import { execSync } from 'child_process'
import { existsSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = dirname(fileURLToPath(import.meta.url))

function run(cmd, cwd) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit' })
}

// 1. Install root deps (concurrently)
run('npm install', root)

// 2. Install backend deps
run('npm install', join(root, 'backend'))

// 3. Install frontend deps
run('npm install', join(root, 'ai-meeting-room'))

// 4. Copy .env.example → .env if .env doesn't exist yet
const envExample = join(root, 'backend', '.env.example')
const envFile    = join(root, 'backend', '.env')

if (!existsSync(envFile)) {
  copyFileSync(envExample, envFile)
  console.log('\n✅ Created backend/.env from .env.example')
  console.log('   → Open backend/.env and fill in your API keys before running npm run dev\n')
} else {
  console.log('\n✅ backend/.env already exists — skipping copy\n')
}

console.log('Setup complete. Run: npm run dev')
