import { type Page } from 'puppeteer';
import { fetchPostWithinPage } from './fetch';

test('POST parse errors do not expose login data, headers, or response bodies', async () => {
  const page = {
    evaluate: () => Promise.resolve(['malformed-sensitive-response', 200]),
  } as unknown as Page;
  const password = 'test-password-canary';
  const token = 'test-token-canary';

  await expect(
    fetchPostWithinPage(page, 'https://example.invalid/login', { password }, { Authorization: token }),
  ).rejects.toThrow('fetchPostWithinPage returned invalid JSON (status: 200)');

  try {
    await fetchPostWithinPage(page, 'https://example.invalid/login', { password }, { Authorization: token });
  } catch (error) {
    const message = String(error);
    expect(message).not.toContain(password);
    expect(message).not.toContain(token);
    expect(message).not.toContain('malformed-sensitive-response');
  }
});
