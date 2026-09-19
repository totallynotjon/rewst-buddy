/* global acquireVsCodeApi, document, window */
(function () {
	const vscode = acquireVsCodeApi();
	const defaultState = {
		organizations: [],
		organizationSearch: '',
		organizationPickerOpen: false,
		selectedOrgId: '',
		catalogOrgId: '',
		workflows: [],
		visibleIds: [],
		selectedIds: [],
		tags: [],
		tagSearch: '',
		filters: {
			search: '',
			tagIds: [],
			tagMatch: 'any',
			createdFrom: '',
			createdTo: '',
			updatedFrom: '',
			updatedTo: '',
		},
		mode: 'separate',
		useWorkflowNames: false,
		destination: { kind: 'directory', isDefault: true },
		exporting: false,
		maxWorkflowsPerExport: 25,
	};
	const persistedState = vscode.getState() || {};
	const state = Object.assign({}, defaultState, persistedState, {
		filters: Object.assign({}, defaultState.filters, persistedState.filters || {}),
		destination: Object.assign({}, defaultState.destination, persistedState.destination || {}),
	});
	const app = document;
	function save() {
		vscode.setState(
			Object.assign({}, state, {
				organizationSearch: '',
				tagSearch: '',
				filters: Object.assign({}, state.filters, { search: '' }),
			}),
		);
	}
	function esc(value) {
		return String(value ?? '').replace(
			/[&<>'"]/g,
			c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
		);
	}
	function dateValue(value) {
		if (!value) return undefined;
		const text = String(value);
		let date;
		if (/^\d+$/.test(text)) {
			const number = Number(text);
			date = new Date(text.length <= 10 ? number * 1000 : number);
		} else {
			date = new Date(value);
		}
		return Number.isNaN(date.getTime()) ? undefined : date;
	}
	function tagsOf(workflow) {
		return Array.isArray(workflow.tags) ? workflow.tags.filter(tag => tag && tag.id) : [];
	}
	function selected() {
		return new Set(state.selectedIds);
	}
	function currentVisible() {
		return state.workflows.filter(workflow => state.visibleIds.includes(workflow.id));
	}
	function setStatus(text, error) {
		const node = app.getElementById('status');
		node.textContent = text || '';
		node.className = error ? 'error' : '';
	}
	function sendFilters() {
		vscode.postMessage({ type: 'applyFilters', filters: state.filters });
	}
	function renderOrganizations() {
		const search = (state.organizationSearch || '').trim().toLocaleLowerCase();
		const matching = state.organizations.filter(org =>
			`${org.name} ${org.id}`.toLocaleLowerCase().includes(search),
		);
		const list = app.getElementById('organizationList');
		const selectedOrg = state.organizations.find(org => org.id === state.selectedOrgId);
		app.getElementById('organizationSearch').value = state.organizationSearch || '';
		app.getElementById('selectedOrganization').textContent = selectedOrg
			? `Selected: ${selectedOrg.name}`
			: 'Choose an organization';
		app.getElementById('changeOrganization').hidden = !selectedOrg;
		app.getElementById('organizationPicker').hidden = Boolean(selectedOrg && !state.organizationPickerOpen);
		list.innerHTML =
			matching
				.map(
					org =>
						`<button type="button" class="organization-option${org.id === state.selectedOrgId ? ' selected' : ''}" data-org-id="${esc(org.id)}" role="option" aria-selected="${org.id === state.selectedOrgId}"><strong>${esc(org.name)}</strong><small>${esc(org.id)}</small></button>`,
				)
				.join('') || '<p class="muted">No organizations match this search.</p>';
		for (const button of list.querySelectorAll('[data-org-id]'))
			button.onclick = event => {
				const id = event.currentTarget.dataset.orgId;
				if (!state.organizations.some(org => org.id === id)) return;
				state.selectedOrgId = id;
				state.organizationSearch = '';
				state.organizationPickerOpen = false;
				state.catalogOrgId = '';
				state.workflows = [];
				state.visibleIds = [];
				state.selectedIds = [];
				save();
				render();
				loadCatalog();
			};
	}
	function renderTags() {
		const search = (state.tagSearch || '').trim().toLocaleLowerCase();
		const selectedTags = new Set(state.filters.tagIds);
		const matching = state.tags.filter(
			tag => !search || `${tag.name} ${tag.id}`.toLocaleLowerCase().includes(search) || selectedTags.has(tag.id),
		);
		const list = app.getElementById('tagList');
		app.getElementById('tagSearch').value = state.tagSearch || '';
		app.getElementById('tagSelectionCount').textContent = selectedTags.size
			? `${selectedTags.size} selected`
			: 'All tags';
		app.getElementById('clearTags').disabled = selectedTags.size === 0;
		list.innerHTML =
			matching
				.map(
					tag =>
						`<button type="button" class="tag-option${selectedTags.has(tag.id) ? ' selected' : ''}" data-tag-id="${esc(tag.id)}" role="option" aria-selected="${selectedTags.has(tag.id)}">${esc(tag.name)}<span>${selectedTags.has(tag.id) ? '✓' : '+'}</span></button>`,
				)
				.join('') || '<p class="muted">No tags match this search.</p>';
		for (const button of list.querySelectorAll('[data-tag-id]'))
			button.onclick = event => {
				const id = event.currentTarget.dataset.tagId;
				state.filters.tagIds = selectedTags.has(id)
					? state.filters.tagIds.filter(value => value !== id)
					: [...state.filters.tagIds, id];
				save();
				renderTags();
				sendFilters();
			};
		for (const radio of app.querySelectorAll('input[name="tagMatch"]'))
			radio.checked = radio.value === state.filters.tagMatch;
	}
	function renderWorkflows() {
		const picked = selected();
		const visible = new Set(state.visibleIds);
		const list = app.getElementById('workflowList');
		list.innerHTML =
			state.workflows
				.filter(workflow => visible.has(workflow.id))
				.map(workflow => {
					const tags = tagsOf(workflow)
						.map(tag => `<span class="pill">${esc(tag.name || tag.id)}</span>`)
						.join('');
					const edited = dateValue(workflow.updatedAt);
					return `<button type="button" class="workflow${picked.has(workflow.id) ? ' selected' : ''}" data-workflow-id="${esc(workflow.id)}" aria-pressed="${picked.has(workflow.id)}"><span class="workflow-check" aria-hidden="true">${picked.has(workflow.id) ? '✓' : ''}</span><span class="workflow-main"><strong>${esc(workflow.name || workflow.id)}</strong><small>${esc(workflow.id)} · edited ${edited ? esc(edited.toLocaleDateString()) : 'unknown'}</small><span>${tags}</span></span></button>`;
				})
				.join('') || '<p class="muted">No workflows match the current filters.</p>';
		app.getElementById('catalogCount').textContent = `${state.visibleIds.length} / ${state.workflows.length}`;
		app.getElementById('selectionCount').textContent =
			`${picked.size} selected · ${state.visibleIds.length} visible`;
		for (const input of app.querySelectorAll('[data-workflow-id]'))
			input.onclick = event => {
				const id = event.currentTarget.dataset.workflowId;
				state.selectedIds = picked.has(id)
					? state.selectedIds.filter(value => value !== id)
					: [...new Set([...state.selectedIds, id])];
				save();
				renderWorkflows();
				renderActions();
			};
	}
	function renderDestination() {
		const destination = state.destination || { kind: 'directory', isDefault: true };
		app.getElementById('destinationPath').textContent = destination.isDefault
			? 'Default Rewst export folder'
			: destination.path || 'Selected folder';
		app.getElementById('chooseFile').disabled =
			state.mode !== 'bundle' || selected().size > state.maxWorkflowsPerExport;
	}
	function renderActions() {
		const count = selected().size;
		app.getElementById('startExport').disabled = state.exporting || count === 0 || !state.selectedOrgId;
		app.getElementById('cancelExport').hidden = !state.exporting;
		app.getElementById('useWorkflowNames').disabled = state.mode !== 'separate';
		renderDestination();
	}
	function restoreControls() {
		app.getElementById('workflowSearch').value = state.filters.search || '';
		for (const id of ['createdFrom', 'createdTo', 'updatedFrom', 'updatedTo']) {
			app.getElementById(id).value = state.filters[id] || '';
		}
		for (const radio of app.querySelectorAll('input[name="mode"]')) radio.checked = radio.value === state.mode;
		app.getElementById('useWorkflowNames').checked = state.useWorkflowNames === true;
	}
	function render() {
		restoreControls();
		renderOrganizations();
		renderTags();
		renderWorkflows();
		renderActions();
	}
	function loadCatalog() {
		if (state.selectedOrgId) vscode.postMessage({ type: 'loadCatalog', orgId: state.selectedOrgId });
	}
	function wire() {
		app.getElementById('organizationSearch').oninput = event => {
			state.organizationSearch = event.target.value;
			renderOrganizations();
		};
		app.getElementById('changeOrganization').onclick = () => {
			state.organizationPickerOpen = true;
			save();
			renderOrganizations();
			app.getElementById('organizationSearch').focus();
		};
		app.getElementById('refreshCatalog').onclick = loadCatalog;
		app.getElementById('workflowSearch').oninput = event => {
			state.filters.search = event.target.value;
			sendFilters();
		};
		app.getElementById('tagSearch').oninput = event => {
			state.tagSearch = event.target.value;
			renderTags();
		};
		app.getElementById('clearTags').onclick = () => {
			state.filters.tagIds = [];
			save();
			renderTags();
			sendFilters();
		};
		for (const radio of app.querySelectorAll('input[name="tagMatch"]'))
			radio.onchange = event => {
				state.filters.tagMatch = event.target.value;
				save();
				sendFilters();
			};
		for (const id of ['createdFrom', 'createdTo', 'updatedFrom', 'updatedTo'])
			app.getElementById(id).onchange = event => {
				state.filters[id] = event.target.value;
				save();
				sendFilters();
			};
		app.getElementById('selectFiltered').onclick = () => {
			state.selectedIds = [...new Set([...state.selectedIds, ...state.visibleIds])];
			save();
			renderWorkflows();
			renderActions();
		};
		app.getElementById('clearSelection').onclick = () => {
			state.selectedIds = [];
			save();
			renderWorkflows();
			renderActions();
		};
		for (const radio of app.querySelectorAll('input[name="mode"]'))
			radio.onchange = event => {
				state.mode = event.target.value;
				save();
				renderActions();
			};
		app.getElementById('useWorkflowNames').onchange = event => {
			state.useWorkflowNames = event.target.checked;
			save();
		};
		app.getElementById('useDefault').onclick = () => vscode.postMessage({ type: 'useDefaultDestination' });
		app.getElementById('chooseFolder').onclick = () => vscode.postMessage({ type: 'chooseFolder' });
		app.getElementById('chooseFile').onclick = () =>
			vscode.postMessage({ type: 'chooseFile', workflowCount: selected().size });
		app.getElementById('startExport').onclick = () => {
			state.exporting = true;
			save();
			renderActions();
			vscode.postMessage({
				type: 'startExport',
				orgId: state.selectedOrgId,
				workflowIds: state.selectedIds,
				mode: state.mode,
				useWorkflowNames: state.useWorkflowNames,
			});
		};
		app.getElementById('cancelExport').onclick = () => vscode.postMessage({ type: 'cancelExport' });
	}
	window.addEventListener('message', event => {
		const message = event.data || {};
		if (message.type === 'bootstrap') {
			state.organizations = message.organizations || [];
			state.exporting = false;
			state.catalogOrgId = typeof message.catalogOrgId === 'string' ? message.catalogOrgId : '';
			if (Number.isInteger(message.maxWorkflowsPerExport) && message.maxWorkflowsPerExport > 0)
				state.maxWorkflowsPerExport = message.maxWorkflowsPerExport;
			if (!state.organizations.some(org => org.id === state.selectedOrgId)) {
				state.selectedOrgId = '';
				state.catalogOrgId = '';
				state.workflows = [];
				state.visibleIds = [];
				state.selectedIds = [];
				state.tags = [];
			}
			if (!state.selectedOrgId) state.selectedOrgId = state.organizations[0]?.id || '';
			state.destination = state.destination || {
				kind: 'directory',
				path: message.defaultDirectory,
				isDefault: true,
			};
			app.getElementById('progress').hidden = true;
			app.getElementById('progress').value = 0;
			save();
			render();
			if (state.selectedOrgId && (!state.workflows.length || state.catalogOrgId !== state.selectedOrgId))
				loadCatalog();
		}
		if (message.type === 'organizations') {
			state.organizations = message.organizations || [];
			if (!state.organizations.some(org => org.id === state.selectedOrgId)) {
				state.selectedOrgId = '';
				state.catalogOrgId = '';
				state.workflows = [];
				state.visibleIds = [];
				state.selectedIds = [];
			}
			save();
			render();
		}
		if (message.type === 'catalogLoading') {
			setStatus('Loading workflows…');
			app.getElementById('refreshCatalog').disabled = true;
		}
		if (message.type === 'catalogLoaded') {
			state.catalogOrgId = typeof message.orgId === 'string' ? message.orgId : state.selectedOrgId;
			state.workflows = message.workflows || [];
			state.visibleIds = state.workflows.map(workflow => workflow.id);
			state.tags = message.tags || [];
			state.filters.tagIds = state.filters.tagIds.filter(id => state.tags.some(tag => tag.id === id));
			state.selectedIds = state.selectedIds.filter(id => state.workflows.some(workflow => workflow.id === id));
			app.getElementById('refreshCatalog').disabled = false;
			setStatus(`Loaded ${state.workflows.length} workflows.`);
			save();
			render();
			sendFilters();
		}
		if (message.type === 'filterResult') {
			state.visibleIds = message.workflowIds || [];
			save();
			renderWorkflows();
		}
		if (message.type === 'destination') {
			state.destination = { kind: message.kind, path: message.path, isDefault: message.isDefault === true };
			save();
			renderDestination();
		}
		if (message.type === 'exportStarted') {
			state.exporting = true;
			app.getElementById('progress').hidden = false;
			app.getElementById('progress').value = 0;
			setStatus(`Exporting ${message.workflowCount} workflows…`);
			save();
			renderActions();
		}
		if (message.type === 'exportProgress') {
			app.getElementById('progress').value = message.percent || 0;
			setStatus(message.message || 'Exporting…');
		}
		if (message.type === 'exportComplete') {
			state.exporting = false;
			const summary = message.cancelled
				? `Export cancelled. ${message.fileCount || 0} files saved.`
				: `Exported ${message.exportedWorkflowCount || 0} workflows to ${message.fileCount || 0} files.`;
			setStatus(message.failures?.length ? `${summary} ${message.failures.length} export(s) failed.` : summary);
			const results = app.getElementById('results');
			results.innerHTML = (message.outputPaths || [])
				.map(
					path =>
						`<button class="link" data-reveal="${esc(path)}">Reveal ${esc(path.split(/[\\/]/).pop())}</button>`,
				)
				.join('');
			for (const button of results.querySelectorAll('[data-reveal]'))
				button.onclick = event => vscode.postMessage({ type: 'reveal', path: event.target.dataset.reveal });
			save();
			renderActions();
		}
		if (message.type === 'error') {
			state.exporting = false;
			app.getElementById('refreshCatalog').disabled = false;
			setStatus(message.message || 'Workflow export failed.', true);
			save();
			renderActions();
		}
	});
	wire();
	render();
	vscode.postMessage({ type: 'ready' });
})();
