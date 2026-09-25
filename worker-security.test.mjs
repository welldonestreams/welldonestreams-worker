import test from 'node:test'
import assert from 'node:assert/strict'
import worker from './worker.js'

function namespace() {
  const values = new Map()
  return {
    async get(key) { return values.get(key) ?? null },
    async put(key, value) { values.set(key, value) },
    async delete(key) { values.delete(key) },
  }
}

test('unset bearer secrets cannot authorize protected routes', async () => {
  const env = { CACHE: namespace(), POLL_DATA: namespace() }
  const cases = [
    ['PUT', '/api/poll/admin', { options: ['A'] }, 403],
    ['POST', '/api/recent-push', { title: 'A' }, 401],
    ['GET', '/api/requests', undefined, 401],
  ]
  for (const [method, path, body, expected] of cases) {
    const request = new Request(`https://welldonestreams.com${path}`, {
      method,
      headers: { Authorization: 'Bearer undefined', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const response = await worker.fetch(request, env, {})
    assert.equal(response.status, expected, path)
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  }
})

test('access request HTML email escapes untrusted names', async () => {
  const originalFetch = globalThis.fetch
  let email
  globalThis.fetch = async (_url, options) => {
    email = JSON.parse(options.body)
    return new Response('{}', { status: 200 })
  }
  try {
    const env = { CACHE: namespace(), ACCESS_REQUESTS: namespace(), RESEND_API_KEY: 'test-only' }
    const request = new Request('https://welldonestreams.com/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1' },
      body: JSON.stringify({ name: '<script>alert(1)</script>', email: 'test@example.com' }),
    })
    const response = await worker.fetch(request, env, {})
    assert.equal(response.status, 200)
    assert.match(email.html, /&lt;script&gt;/)
    assert.doesNotMatch(email.html, /<script>/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
