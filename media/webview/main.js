(function () {
	const vscode = acquireVsCodeApi();

	const tokenInput = document.getElementById('tokenInput');
	const submitBtn = document.getElementById('submitBtn');

	submitBtn.addEventListener('click', () => {
		const token = tokenInput.value;
		if (token && token.trim()) {
			vscode.postMessage({
				type: 'submitToken',
				token: token,
			});
			tokenInput.value = '';
		}
	});

	tokenInput.addEventListener('keydown', e => {
		if (e.key === 'Enter') {
			submitBtn.click();
		}
	});
})();
