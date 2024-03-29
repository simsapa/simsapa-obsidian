import * as path from "path";
import * as fs from "fs";

// @ts-ignore
import sidebar_html_data from 'raw-loader!./static/sidebar.html';
// @ts-ignore
import sidebar_js_data from 'raw-loader!./static/sidebar.js';
// @ts-ignore
import sidebar_css_data from 'raw-loader!./static/sidebar.css';

import { Editor, MarkdownView, Plugin, WorkspaceLeaf, Platform, requestUrl, RequestUrlParam } from 'obsidian';
import { SERVER_PORT, SimsapaView, VIEW_TYPE_SIMSAPA, WS_SERVER_PORT } from './simsapa-view';

import { getPluginAbsolutePath } from './Common';
import { WebSocketServer } from "ws";

const SIMSAPA_BASE_URL = "http://localhost:4848";
const HEARTBEAT_TIME_MS = 10000; // 10s

function sanitize_selection(text: string): string {
    // Remove Markdown syntax which may be part of a double-click selection.
    return text.replace(/[\`\#\*_]/g, "");
}

function show_word(uid: string): void {
    const url = SIMSAPA_BASE_URL + "/lookup_window_query";
    const data = { query_text: uid };

    const params: RequestUrlParam = {
        url: url,
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(data),
    }

    requestUrl(params)
        .catch(error => console.error('Error:', error));
}

export default class SimsapaPlugin extends Plugin {
    server: any;
    ws_server: WebSocketServer | null = null;
    ws_sockets: any[];
    ws_heartbeat_timer: NodeJS.Timer | null = null;
    plugin_folder: string;
    static_folder: string;

    async onload() {
        this.registerView(
            VIEW_TYPE_SIMSAPA,
            (leaf) => new SimsapaView(leaf),
        );

        const ribbon_icon_el = this.addRibbonIcon('book', 'Simsapa', (_evt: MouseEvent) => {
            this.activate_simsapa_view();
        });
        ribbon_icon_el.addClass('my-plugin-ribbon-class');

        this.plugin_folder = getPluginAbsolutePath(this, Platform.isWin);
        this.static_folder = path.join(this.plugin_folder, 'static');

        this.ensure_static_files();

        // NOTE: Use Obsidian plugin guideline prefers sentence-case:
        // Prefer "Create new note" over "Create New Note".

        this.addCommand({
            id: 'open-sidebar',
            name: 'Open sidebar',
            callback: () => {
                this.activate_simsapa_view();
            }
        });

        this.addCommand({
            id: 'lookup-selection-in-dictionary',
            name: 'Lookup selection in dictionary',

            // Linux, Windows: Ctrl+Shift+D
            // MacOS: Cmd+Shift+D
            // NOTE: Plugin guidelines recommend not setting default hotkeys for commands to avoid conflicts.
            // hotkeys: [{ modifiers: ["Mod", "Shift"], key: "d" }],
            editorCallback: (editor: Editor, _view: MarkdownView) => {
                const sel = editor.getSelection()
                this.simsapa_lookup(`${sel}`);
            },
        });

        this.start_static_server();
        this.start_websocket_server();

        this.registerDomEvent(document, 'dblclick', () => {
            const sel = document.getSelection();
            this.simsapa_lookup(`${sel}`);
        });
    }

    onunload() {
        // The plugin is disabled. This action doesn't run when the sidebar is closed with the icon.
        this.server.close();
        if (this.ws_server) {
            this.ws_server.close();
        }
    }

    simsapa_lookup(sel_txt: string): void {
        sel_txt = sanitize_selection(sel_txt);
        if (this.is_sidebar_open()) {
            this.simsapa_sidebar_lookup(sel_txt);
        } else {
            this.simsapa_app_lookup(sel_txt);
        }
    }

    simsapa_sidebar_lookup(sel_txt: string): void {
        const data = JSON.stringify({
            "selection": sel_txt,
        });
        this.ws_sockets.forEach(s => s.send(data));
    }

    simsapa_app_lookup(sel_txt: string): void {
        show_word(sel_txt);
    }

    async activate_simsapa_view(): Promise<void> {
        let { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;

        let sidebar = this.get_simsapa_sidebar_leaf();

        if (sidebar !== null) {
            leaf = sidebar;
        } else {
            // Our view could not be found in the workspace, create a new leaf
            // in the right sidebar for it
            let leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_SIMSAPA, active: true });
        }

        // "Reveal" the leaf in case it is in a collapsed sidebar
        if (leaf !== null) {
            workspace.revealLeaf(leaf);
        }
    }

    get_simsapa_sidebar_leaf(): WorkspaceLeaf | null {
        let { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        let leaves = workspace.getLeavesOfType(VIEW_TYPE_SIMSAPA);

        if (leaves.length > 0) {
            // A leaf with our view already exists, use that
            leaf = leaves[0];
            return leaf;
        } else {
            return null;
        }
    }

    is_sidebar_open(): boolean {
        if (this.app.workspace.rightSplit.collapsed) {
            return false;
        }

        // null when the sidebar is closed with the icon
        let sidebar = this.get_simsapa_sidebar_leaf();
        if (sidebar === null) {
            return false;
        }

        return true;
    }

    ensure_static_files() {
        if (!fs.existsSync(this.static_folder)) {
            fs.mkdirSync(this.static_folder);

            fs.writeFileSync(path.join(this.static_folder, "sidebar.html"), sidebar_html_data);
            fs.writeFileSync(path.join(this.static_folder, "sidebar.js"), sidebar_js_data);
            fs.writeFileSync(path.join(this.static_folder, "sidebar.css"), sidebar_css_data);
        }
    }

    async start_static_server() {
        const finalhandler = require('finalhandler');
        const http = require('http');
        const serve_static = require('serve-static');

        const serve = serve_static(this.static_folder, { index: ['sidebar.html',] });

        const server = http.createServer(function onRequest(req: any, res: any) {
            serve(req, res, finalhandler(req, res));
        })
        this.server = server;

        server.listen(SERVER_PORT);
    }

    async start_websocket_server() {
        this.ws_server = new WebSocketServer({ port: WS_SERVER_PORT });
        this.ws_sockets = [];

        // keep the connection alive, msg every 10s
        this.ws_heartbeat_timer = setInterval(this.send_ws_heartbeat, HEARTBEAT_TIME_MS);

        this.ws_server.on('connection', (socket: any) => {
            this.ws_sockets.push(socket);

            // socket.on('message', (data: any) => {
            //     console.log("client says: ", data);
            // });

            // When a socket closes, or disconnects, remove it from the array.
            socket.on('close', () => {
                this.ws_sockets = this.ws_sockets.filter((s: any) => s !== socket);
            });
        });

        this.ws_server.on('close', () => {
            if (this.ws_heartbeat_timer) {
                clearInterval(this.ws_heartbeat_timer);
                this.ws_heartbeat_timer = null;
            }
        });
    }

    send_ws_heartbeat() {
        if (this.ws_server) {
            this.ws_sockets.forEach(s => s.send("ping"));
        }
    }

    public getPluginId() {
        return this.manifest.id;
    }
}

