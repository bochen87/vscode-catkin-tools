import * as vscode from 'vscode';
import * as glob from 'fast-glob';
import * as fs from 'fs';
import * as path from 'path';
import * as jsonfile from 'jsonfile';

import { Package } from "./package";
import { runShellCommand } from './shell_command';
import { getExtensionConfiguration } from './configuration';

export class GTestSuite {
    constructor(
        public targets: GTestBuildTarget[],
    ) { }

    public getBuildTarget(name: string): GTestBuildTarget {
        for (const gtest_build_target of this.targets) {
            if (gtest_build_target.name === name) {
                return gtest_build_target;
            }
        }

    }

    public getFixture(name: string): [GTestTestFixture, TestSource, GTestBuildTarget] {
        for (const gtest_build_target of this.targets) {
            const [fixture, test_source] = gtest_build_target.getFixture(name);
            if (fixture) {
                return [fixture, test_source, gtest_build_target];
            }
        }

        return [undefined, undefined, undefined];
    }

    public getTestCase(fixture_name: string, test_case_name: string): [GTestTestCase, GTestTestFixture, TestSource, GTestBuildTarget] {
        for (const gtest_build_target of this.targets) {
            const [test_case, fixture, test_source] = gtest_build_target.getTestCase(fixture_name, test_case_name);
            if (test_case) {
                return [test_case, fixture, test_source, gtest_build_target];
            }
        }

        return [undefined, undefined, undefined, undefined];
    }
}
export class GTestBuildTarget {
    constructor(
        public name: string,
        public package_relative_file_path: fs.PathLike,
        public line: number,
        public test_sources: TestSource[] = [],
    ) { }

    public getFixture(name: string): [GTestTestFixture, TestSource] {
        for (const test_source of this.test_sources) {
            const fixture = test_source.getFixture(name);
            if (fixture) {
                return [fixture, test_source];
            }
        }

        return [undefined, undefined];
    }

    public getTestCase(fixture_name: string, test_case_name: string): [GTestTestCase, GTestTestFixture, TestSource] {
        for (const test_source of this.test_sources) {
            const [test_case, fixture] = test_source.getTestCase(fixture_name, test_case_name);
            if (test_case) {
                return [test_case, fixture, test_source];
            }
        }

        return [undefined, undefined, undefined];
    }
}
export class TestSource {
    constructor(
        public package_relative_file_path: fs.PathLike,
        public test_fixtures: GTestTestFixture[] = [],
    ) { }

    public getFixture(name: string): GTestTestFixture {
        for (const test_fixture of this.test_fixtures) {
            if (test_fixture.name === name) {
                return test_fixture;
            }
        }
    }

    public getTestCase(fixture_name: string, test_case_name: string): [GTestTestCase, GTestTestFixture] {
        for (const test_fixture of this.test_fixtures) {
            if (test_fixture.name === fixture_name) {
                return [test_fixture.getTestCase(test_case_name), test_fixture];
            }
        }

        return [undefined, undefined];
    }
}
export class GTestTestFixture {
    constructor(
        public name: string,
        public line: number,
        public test_cases: GTestTestCase[] = [],
    ) { }

    public getTestCase(name: string): GTestTestCase {
        for (const test_case of this.test_cases) {
            if (test_case.name === name) {
                return test_case;
            }
        }
    }
}

export class GTestTestCase {
    constructor(
        public name: string,
        public line: number,
    ) { }
}


export async function skimCmakeListsForTests(workspace_package: Package): Promise<boolean> {
    let test_regexes: RegExp[] = [];
    for (let expr of getExtensionConfiguration('gtestMacroRegex')) {
        test_regexes.push(new RegExp(`.*(${expr})`));
    }

    const cmake_lists_pattern = `${workspace_package.getAbsolutePath()}/**/CMakeLists.txt`;
    const cmake_files = await glob.async(
        [cmake_lists_pattern]
    );
    for (let cmake_file of cmake_files) {
        let target_iterator = iterateTestTargets(cmake_file.toString());
        let target = await target_iterator.next();
        while (!target.done) {
            target_iterator.return();
            return true;
        }
    }
    return false;
}

export async function parsePackageForTests(workspace_package: Package): Promise<GTestSuite> {
    console.log(workspace_package.cmakelists_path);
    return queryCMakeFileApiCodeModel(workspace_package);
}

async function* iterateTestTargets(cmake_file: fs.PathLike) {
    let test_regexes: RegExp[] = [];
    for (let expr of getExtensionConfiguration('gtestMacroRegex')) {
        test_regexes.push(new RegExp(`.*(${expr})`));
    }

    let data = await fs.promises.readFile(cmake_file.toString());
    let cmake = data.toString();
    for (let test_regex of test_regexes) {
        for (let row of cmake.split('\n')) {
            let tests = row.match(test_regex);
            if (tests) {
                yield row;
            }
        }
    }
}

async function queryCMakeFileApiCodeModel(workspace_package: Package): Promise<GTestSuite> {
    const package_space = workspace_package.getAbsolutePath();
    const build_space = workspace_package.build_space.toString();
    const api_dir = path.join(build_space, ".cmake", "api", "v1");
    const query_dir = path.join(api_dir, "query", "client-workspace-vscode");
    try {
        await fs.promises.mkdir(query_dir, { recursive: true });

        const query_txt = `{ "requests": [{"kind": "codemodel", "version": 2 }] }`;
        const query_file = path.join(query_dir, "query.json");
        await fs.promises.writeFile(query_file, query_txt);
        const source_command = workspace_package.workspace.workspace_provider.makeRosSourcecommand();
        const output = await runShellCommand(source_command + "; cmake .", build_space);
        console.log(output.stdout);
    } catch (error) {
        console.error(error);
        return undefined;
    }

    const reply_dir = path.join(api_dir, "reply");
    const files = await fs.promises.readdir(reply_dir);

    let test_regexes: RegExp[] = [];
    for (let expr of getExtensionConfiguration('gtestMacroRegex')) {
        test_regexes.push(new RegExp(`.*(${expr})`));
    }

    let build_targets = new Map<string, GTestBuildTarget>();
    for (const file_name of files) {
        if (file_name.startsWith("target")) {
            const file_path = path.join(reply_dir, file_name);
            console.log(file_path);
            const target = await jsonfile.readFile(file_path);
            if (isGtestTarget(target)) {
                for (const source of target.sources) {
                    try {
                        let build_target = build_targets.get(target.name);
                        if (build_target === undefined) {
                            const line_number = traceLineNumber(target, test_regexes);
                            build_target = new GTestBuildTarget(target.name, path.join(target.paths.source, "CMakeLists.txt"), line_number);
                            build_targets.set(target.name, build_target);
                        }
                        build_target.test_sources.push(new TestSource(
                            source.path,
                            await analyzeGtestSource(path.join(package_space.toString(), source.path))
                        ));
                    } catch (error) {
                        console.error(`Cannot analyze ${source.path}'s test details: ${error}`);
                    }
                }
            }
        }
    }

    return new GTestSuite(Array.from(build_targets.values()));
}

function traceLineNumber(target, test_regexes: RegExp[]) {
    const graph = target.backtraceGraph;
    for (const node of graph.nodes) {
        if (node.command !== undefined) {
            const command = graph.commands[node.command];
            for (let test_regex of test_regexes) {
                if (command.match(test_regex) !== null) {
                    return node.line - 1;
                }
            }
        }

    }
    return undefined;
}

async function analyzeGtestSource(source_file: fs.PathLike): Promise<GTestTestFixture[]> {
    console.log(`Analyzing ${source_file} for gtest names`);
    let test_fixtures = new Map<string, GTestTestFixture>();
    let data = await fs.promises.readFile(source_file);

    const gtest_regex_start = new RegExp(/\s*TEST(_[PF])?\(/);
    const gtest_regex = new RegExp(/\s*TEST(_[PF])?\(([^,]+)\s*,\s*([^,]+)\)\s*/);

    let line_number = 0;
    const source_code = data.toString().split("\n");
    let current_line = "";
    for (let raw_line_index = 0; raw_line_index < source_code.length; ++raw_line_index) {
        const raw_line = source_code[raw_line_index];
        const line = raw_line.trimLeft();
        let line_length = 1;
        if (line.match(gtest_regex_start) !== null) {
            current_line = line;
            console.log(line);
            while (current_line.indexOf('{') < 0 && raw_line_index < source_code.length) {
                raw_line_index += 1;
                line_length += 1;
                const raw_line = source_code[raw_line_index];
                current_line += raw_line.trimLeft();
            }
            const gtest = current_line.match(gtest_regex);
            if (gtest !== null) {
                const test_fixture_name = gtest[2];
                const test_case_name = gtest[3];

                let fixture = test_fixtures.get(test_fixture_name);
                if (fixture === undefined) {
                    const fixture_line_number = findFirstLine(source_code, test_fixture_name);
                    fixture = new GTestTestFixture(test_fixture_name, fixture_line_number !== undefined ? fixture_line_number : line_number);
                    test_fixtures.set(test_fixture_name, fixture);
                }

                fixture.test_cases.push(new GTestTestCase(test_case_name, line_number));
            }
        }
        line_number += line_length;
    }
    return Array.from(test_fixtures.values());
}

function findFirstLine(source_code: string[], key: string): number {
    const regex = new RegExp(`(^|.*\\s)(${key})([\\s;:{].*|$)`);
    let line_number = 0;
    for (const line of source_code) {
        if (line.indexOf(key) >= 0) {
            const match = line.match(regex);
            if (match !== null) {
                return line_number;
            }
        }
        line_number += 1;
    }
    return undefined;
}

function isGtestTarget(target: any) {
    if (target.dependencies !== undefined && target.type === "EXECUTABLE") {
        for (const dependency of target.dependencies) {
            console.log(dependency.id);
            if (dependency.id.indexOf('gtest') >= 0 || dependency.id.indexOf('gmock') >= 0) {
                return true;
            }
        }
    }
    return false;
}