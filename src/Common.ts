// https://github.com/Taitava/obsidian-shellcommands/blob/1bb751bcbb3efd01218ec622d85322e258340e4d/src/Common.ts

/*
 * 'Shell commands' plugin for Obsidian.
 * Copyright (C) 2021 - 2023 Jarkko Linnanvirta
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3.0 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * Contact the author (Jarkko Linnanvirta): https://github.com/Taitava/
 */

import {
    App,
    FileSystemAdapter,
    normalizePath,
} from "obsidian";

import * as path from "path";
import SimsapaPlugin from "./main";

export function getVaultAbsolutePath(app: App) {
    // Original code was copied 2021-08-22 from https://github.com/phibr0/obsidian-open-with/blob/84f0e25ba8e8355ff83b22f4050adde4cc6763ea/main.ts#L66-L67
    // But the code has been rewritten 2021-08-27 as per https://github.com/obsidianmd/obsidian-releases/pull/433#issuecomment-906087095
    const adapter = app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
        return adapter.getBasePath();
    }
    throw new Error("Could not retrieve vault path. No DataAdapter was found from app.vault.adapter.");
}

export function getPluginAbsolutePath(plugin: SimsapaPlugin, convertSlashToBackslash: boolean) {
    return normalizePath2(
        path.join(
            getVaultAbsolutePath(plugin.app),
            plugin.app.vault.configDir,
            "plugins",
            plugin.getPluginId()
        ),
        convertSlashToBackslash
    );
}

/**
 * Same as normalizePath(), but fixes these glitches:
 * - Leading forward slashes / backward slashes should not be removed.
 * - \ should not be converted to / if platform is Windows. In other words, / should be converted to \ if platform is Windows.
 *
 * TODO: I've opened a discussion about this on Obsidian's forums. If anything new comes up in the discussion, make changes accordingly. https://forum.obsidian.md/t/normalizepath-removes-a-leading/24713
 */
export function normalizePath2(path: string, convertSlashToBackslash: boolean) {
    // 1. Preparations
    path = path.trim();
    const leading_slashes_regexp = /^[/\\]*/gu; // Get as many / or \ slashes as there are in the very beginning of path. Can also be "" (an empty string).
    const leading_slashes_array = leading_slashes_regexp.exec(path); // An array with only one item.
    if (null === leading_slashes_array) {
        // It should always match. This exception should never happen, but have it just in case.
        throw new Error("normalizePath2(): leading_slashes_regexp did not match.");
    }
    let leading_slashes = leading_slashes_array[0];

    // 2. Run the original normalizePath()
    path = normalizePath(path);

    // 3. Fixes
    // Check that correct slashes are used.
    if (convertSlashToBackslash) {
        // Convert / to \ (usually done when running on Windows, but might in theory happen on other platforms, too, if using a shell that uses Windows directory separators).
        path = path.replace(/\//gu, "\\"); // Need to use a regexp instead of a normal "/" -> "\\" replace because the normal replace would only replace first occurrence of /.
        leading_slashes = leading_slashes.replace(/\//gu, "\\"); // Same here.
    }
    // Now ensure that path still contains leading slashes (if there were any before calling normalizePath()).
    // Check that the path should have a similar set of leading slashes at the beginning. It can be at least "/" (on linux/Mac), or "\\" (on Windows when it's a network path), in theory even "///" or "\\\\\" whatever.
    // normalizePath() seems to remove leading slashes (and they are needed to be re-added), but it's needed to check first, otherwise the path would have double leading slashes if normalizePath() gets fixed in the future.
    if (leading_slashes.length && path.slice(0, leading_slashes.length) !== leading_slashes) {
        // The path does not contain the required set of leading slashes, so add them.
        path = leading_slashes + path;
    }

    // 4. Done
    return path;
}
