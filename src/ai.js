export class AgnesAI {
  constructor(env) {
    this.keys = [env.AGNES_API_KEY_1, env.AGNES_API_KEY_2];
    this.urls = [env.AGNES_API_URL_1, env.AGNES_API_URL_2];
    this.model = env.MODEL || 'agnes-2.5-flash';
    this.maxTokens = parseInt(env.MAX_TOKENS) || 8192;
    this.current = 0;
  }

  async call(messages, options = {}) {
    let lastError = null;
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.current + i) % this.keys.length;
      const key = this.keys[idx];
      const url = this.urls[idx];
      if (!key || !url) continue;

      try {
        const res = await this._request(url, key, messages, options);
        this.current = idx;
        return res;
      } catch (err) {
        lastError = err;
        console.warn(`API ${idx + 1} gagal:`, err.message);
        if (err.message.includes('429') || err.message.includes('rate limit')) continue;
      }
    }
    throw new Error(`Semua API gagal: ${lastError?.message || 'Unknown'}`);
  }

  async _request(url, key, messages, options) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: this.maxTokens,
        temperature: options.temperature || 0.7,
        stream: false,
        ...options,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json();
  }
}
