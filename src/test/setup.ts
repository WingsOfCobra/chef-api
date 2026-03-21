/// <reference types="vitest/globals" />

// Set required env vars BEFORE any source module imports.
// This prevents config.ts from calling process.exit(1)
// and db.ts from writing to the filesystem.
process.env.CHEF_API_KEY = 'test-api-key-12345'
process.env.GITHUB_TOKEN = 'ghp_test_token'
process.env.PORT = '0'
process.env.HOST = '127.0.0.1'
process.env.DOCKER_SOCKET = '/var/run/docker.sock'
process.env.SSH_HOSTS = 'dev:deploy@10.0.0.1:~/.ssh/id_rsa'
process.env.TODO_PATH = '/tmp/test-todo.md'
process.env.DB_PATH = ':memory:'
process.env.NODE_ENV = 'test'
