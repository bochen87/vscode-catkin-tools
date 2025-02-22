import * as vscode from 'vscode';
import * as fs from 'fs';

import { WorkspaceProvider } from "../common/workspace_provider";
import { runColconCommand } from "./colcon_command";

export class ColconWorkspaceProvider implements WorkspaceProvider {
    private catkin_config = new Map<string, string>();

    private workspace_src_dir: string = null;
    private workspace_build_dir: string = null;
    private workspace_install_dir: string = null;

    constructor(
        public associated_workspace_for_tasks: vscode.WorkspaceFolder,
    ) { }

    getWorkspaceType(): string {
        return "colcon";
    }

    async getRootPath(): Promise<fs.PathLike> {
        return this.associated_workspace_for_tasks.uri.fsPath;
    }

    async getSrcDir(): Promise<string> {
        await this.checkProfile();
        if (this.workspace_src_dir === null) {
            this.workspace_src_dir = this.associated_workspace_for_tasks.uri.fsPath + "/src";
        }
        return this.workspace_src_dir;
    }
    async getBuildDir(): Promise<string> {
        await this.checkProfile();
        if (this.workspace_build_dir === null) {
            this.workspace_build_dir = this.associated_workspace_for_tasks.uri.fsPath + "/build";
        }
        return this.workspace_build_dir;
    }
    async getDevelDir(): Promise<string> {
        return undefined;
    }
    async getInstallDir(): Promise<string> {
        await this.checkProfile();
        if (this.workspace_install_dir === null) {
            this.workspace_install_dir = this.associated_workspace_for_tasks.uri.fsPath + "/install";
        }
        return this.workspace_install_dir;
    }

    reload() {
        this.loadColconConfig();
    }

    getCodeWorkspace(): vscode.WorkspaceFolder {
        return this.associated_workspace_for_tasks;
    }

    async getCmakeArguments() {
        return undefined;
    }

    async getBuildTask(): Promise<vscode.Task> {
        let build_tasks = await vscode.tasks.fetchTasks({
            type: "colcon"
        });
        if (build_tasks !== undefined && build_tasks.length > 0) {
            for (let task of build_tasks) {
                if (task.name === "build" && task.scope === this.associated_workspace_for_tasks) {
                    return task;
                }
            }
        }
        return undefined;
    }

    getDefaultRunTestTarget(): string {
        return 'test';
    }

    makePackageBuildCommand(package_name: string): string {
        return `colcon build --packages-up-to ${package_name}`;
    }

    makeRosSourcecommand(): string {
        // determine latest ros2 version
        let find_ros2_version = 'for ROS2_VERSION in $(ls /opt/ros/|sort -r); do AMENT_LINES=$(cat /opt/ros/$ROS2_VERSION/setup.sh | grep ament | wc -l); if [ $AMENT_LINES != "0" ]; then export INSTALL_PREFIX=/opt/ros/$ROS2_VERSION/; break; fi; done';
        let source_script = find_ros2_version + '; source ${INSTALL_PREFIX}/setup.$(echo ${SHELL} | xargs basename)';
        return source_script;
    }

    async enableCompileCommandsGeneration() {
        const cmake_opts = await this.getConfigEntry("Additional CMake Args");
        runColconCommand(['config', '--cmake-args', `${cmake_opts} -DCMAKE_EXPORT_COMPILE_COMMANDS=ON`], await this.getRootPath());
        this.loadColconConfig();
    }

    public async checkProfile() {
    }

    public async getProfiles(): Promise<string[]> {
        return [];
    }

    public async getActiveProfile(): Promise<string> {
        return null;
    }

    public async switchProfile(profile) {
        return false;
    }

    private async loadColconConfig() {
    }

    private async getConfigEntry(key: string): Promise<string> {
        return undefined;
    }

}