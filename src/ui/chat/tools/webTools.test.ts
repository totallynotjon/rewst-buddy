import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import { assertPublicHttpUrl, htmlToText, parseDuckDuckGoResults, runWebTool, type WebToolDeps } from './webTools';

const { suite, test, setup } = Mocha;

function deps(over: Partial<WebToolDeps> = {}): WebToolDeps {
	return {
		isEnabled: () => true,
		fetchRaw: async () => ({ status: 200, body: '' }),
		...over,
	};
}

const RESULT_HTML = `
<div class="result">
	<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.rewst.help%2Fjinja&amp;rut=abc">Jinja &amp; Templates</a>
	<a class="result__snippet" href="x">How to use <b>Jinja</b> in Rewst.</a>
</div>
<div class="result">
	<a rel="nofollow" class="result__a" href="https://example.com/direct">Direct Result</a>
	<a class="result__snippet" href="y">A direct link.</a>
</div>`;

suite('Unit: webTools', () => {
	setup(() => {
		initTestEnvironment();
	});

	suite('assertPublicHttpUrl()', () => {
		test('accepts public http(s) URLs', () => {
			assert.strictEqual(assertPublicHttpUrl('https://example.com/page').hostname, 'example.com');
			assert.strictEqual(assertPublicHttpUrl('http://docs.rewst.help').hostname, 'docs.rewst.help');
		});

		test('rejects non-http protocols and invalid URLs', () => {
			assert.throws(() => assertPublicHttpUrl('ftp://example.com'), /Only http/);
			assert.throws(() => assertPublicHttpUrl('file:///etc/passwd'), /Only http/);
			assert.throws(() => assertPublicHttpUrl('not a url'), /Not a valid URL/);
		});

		test('rejects private and loopback hosts', () => {
			for (const host of [
				'http://localhost:3000',
				'http://127.0.0.1',
				'http://10.0.0.5',
				'http://192.168.1.1',
				'http://172.16.0.1',
				'http://169.254.169.254/latest/meta-data',
				'http://printer.local',
				'http://[::1]:8080',
			]) {
				assert.throws(() => assertPublicHttpUrl(host), /private\/loopback/, `should reject ${host}`);
			}
		});
	});

	suite('htmlToText()', () => {
		test('strips tags, scripts, and decodes entities', () => {
			const html =
				'<html><head><title>t</title></head><body><script>evil()</script><p>Hello &amp; <b>world</b></p></body></html>';
			assert.strictEqual(htmlToText(html), 'Hello & world');
		});

		test('turns block elements into newlines', () => {
			assert.strictEqual(htmlToText('<p>one</p><p>two</p>'), 'one\ntwo');
		});
	});

	suite('parseDuckDuckGoResults()', () => {
		test('decodes uddg redirect URLs and pairs snippets', () => {
			const results = parseDuckDuckGoResults(RESULT_HTML);
			assert.strictEqual(results.length, 2);
			assert.deepStrictEqual(results[0], {
				title: 'Jinja & Templates',
				url: 'https://docs.rewst.help/jinja',
				snippet: 'How to use Jinja in Rewst.',
			});
			assert.strictEqual(results[1].url, 'https://example.com/direct');
		});

		test('returns empty for pages without results', () => {
			assert.deepStrictEqual(parseDuckDuckGoResults('<html>no results here</html>'), []);
		});
	});

	suite('runWebTool()', () => {
		test('fails when web tools are disabled', async () => {
			await assert.rejects(
				runWebTool({ tool: 'web_search', args: { query: 'x' } }, deps({ isEnabled: () => false })),
				/enableWebTools/,
			);
		});

		test('web_search formats results from the search page', async () => {
			const fetched: string[] = [];
			const d = deps({
				fetchRaw: async url => {
					fetched.push(url);
					return { status: 200, body: RESULT_HTML };
				},
			});
			const output = await runWebTool({ tool: 'web_search', args: { query: 'rewst jinja' } }, d);
			assert.match(fetched[0], /^https:\/\/html\.duckduckgo\.com\/html\/\?q=rewst%20jinja/);
			assert.match(output, /Jinja & Templates\nhttps:\/\/docs\.rewst\.help\/jinja\nHow to use Jinja in Rewst\./);
		});

		test('fetch_url follows redirects but blocks private destinations', async () => {
			const d = deps({
				fetchRaw: async url =>
					url === 'https://example.com/'
						? { status: 302, location: 'http://127.0.0.1/secret', body: '' }
						: { status: 200, body: 'x' },
			});
			await assert.rejects(
				runWebTool({ tool: 'fetch_url', args: { url: 'https://example.com/' } }, d),
				/private\/loopback/,
			);
		});

		test('fetch_url returns readable text and surfaces HTTP errors', async () => {
			const ok = await runWebTool(
				{ tool: 'fetch_url', args: { url: 'https://example.com/page' } },
				deps({ fetchRaw: async () => ({ status: 200, body: '<p>Some <b>docs</b></p>' }) }),
			);
			assert.strictEqual(ok, 'Some docs');

			await assert.rejects(
				runWebTool(
					{ tool: 'fetch_url', args: { url: 'https://example.com/missing' } },
					deps({ fetchRaw: async () => ({ status: 404, body: '' }) }),
				),
				/HTTP 404/,
			);
		});
	});
});
