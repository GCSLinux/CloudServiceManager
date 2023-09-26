import YAML from 'yaml';
import fs from 'fs';
import net from 'net';
import * as http from 'http';
import * as util from 'util';
import Docker from 'dockerode';
import { spawn } from 'child_process';
const os = require('os');

import { file_root, SOCKET_PATH, GlobalDocker } from './Constants';
import { RequestDocker } from './DockerUtils';

interface Varable {
    name: string;
    placeholder: string;
    default: string;
}

interface Procedure {
    name: string;
    script: Array < string > ;
}

interface Port {
    name: string;
    protocol: string;
    hostPort: string;
    containerPort: string;
}

interface Stats {
    CpuUsage: number;
    MemoryUsage: number;
}

enum ProcedureStatus {
    Stopped,
    Running,
}

namespace Stats{
    function GetMemoryUsage(ContainerJson : any) : number{
        let memoryUsage = ContainerJson.memory_stats.usage / 1024 / 1024 as number;
        return Number(memoryUsage.toFixed(0));
    }

    function GetCpuUsage(ContainerJson: any): number {
        const numberOfCores = os.cpus().length;
        const containerCpuUsage = ContainerJson.cpu_stats.cpu_usage.total_usage;
        const systemCpuUsage = ContainerJson.cpu_stats.system_cpu_usage;
        
        if (systemCpuUsage > 0) {
          const cpuUsage = (containerCpuUsage / systemCpuUsage) * numberOfCores * 100;
          return parseFloat(cpuUsage.toFixed(2));
        }
        
        return 0; // Return 0 if systemCpuUsage is not available
      }

    export function GenerateStats(ContainerJson : any) : Stats{
        let stats = {} as Stats;
        stats.CpuUsage = GetCpuUsage(ContainerJson);
        stats.MemoryUsage = GetMemoryUsage(ContainerJson);
        return stats;
    }

}

class GcsService {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    vendor: string;

    variables: Array < Varable > ;

    image: string;
    ports: Array < Port > ;
    volumes: Array < string > ;
    environment: Array < string > ;
    procedures: Array < Procedure > ;

    status: ProcedureStatus;

    dockerContainerId: string;

    Stats: Stats;

    StdOutStream: any;

    constructor(id: string) {
        this.id = id;
        this.name = "";
        this.description = "";
        this.author = "";
        this.version = "";
        this.vendor = "";

        this.variables = [];

        this.image = "";
        this.ports = [];
        this.volumes = [];
        this.environment = [];
        this.procedures = [];

        this.dockerContainerId = "";

        this.status = ProcedureStatus.Stopped;

        this.Stats = {} as Stats;

        this.StdOutStream = fs.createWriteStream(file_root + '/' + this.id + '/stdout.log', {
            flags: 'a'
        });

    }

    loadFromYaml(yamlConfig: string): void {
        const config = YAML.parse(yamlConfig);

        this.name = config.name;
        this.version = config.version;
        this.description = config.description;
        this.author = config.author;
        this.vendor = config.vendor;

        this.variables = config.variables;

        this.image = config.container.image;

        this.ports = config.container.ports;

        this.volumes = config.container.volumes;

        for (let i = 0; i < this.volumes.length; i++) {
            this.volumes[i] = file_root + '/' + this.id + '/content' + this.volumes[i];
        }

        this.environment = config.container.environment;

        this.procedures = config.procedures;
    }

    Serialize(): string {
        return JSON.stringify(this);
    }

    GetProcedure(procedureName: string): Procedure | null {
        for (const procedure of this.procedures) {
            if (procedure.name == procedureName) {
                return procedure;
            }
        }
        return null;
    }

    BuildStartupJson(Ports: any, Volumes: any, Env: any): any {

        let PortBindings = {} as any;
        let Binds = new Array < string > ();

        for (const port of Ports) {
            PortBindings[port.containerPort + '/' + port.protocol] = [{
                HostPort: port.hostPort.toString(),
            }];
        }

        console.log(PortBindings);

        for (const volume of Volumes) {
            Binds.push(volume);
        }

        let json = {
            Image: this.image,
            //set unique name for container instead of random by docker
            name: this.id,
            HostConfig: {
                PortBindings: PortBindings,
                Binds: Binds,
                Privileged: false,
                AutoRemove: false,
            },
            Env: Env,
            //disable any output buffering
            //instantly make sure the function HandleStdout is called on every output
            AttachStdout: true,
            AttachStderr: true,
            AttachStdin: false,
            Tty: true,
            OpenStdin: false,
            StdinOnce: false,
            StopSignal: 'SIGTERM',
            StopTimeout: 10,

        };
        return json;
    }

    LoadVariables(): Array < Varable > {
        let variables = this.variables;
        try {
            let file = fs.readFileSync(file_root + '/' + this.id + '/variables.json', 'utf8');
            let fileVariables = JSON.parse(file);
            //go through variables and try to find them in file. if found, ajust default value
            for (const variable of variables) {
                //search for variable with same placeholder
                for (const fileVariable of fileVariables) {
                    if (variable.placeholder == fileVariable.placeholder) {
                        variable.default = fileVariable.default;
                        break;
                    }
                }
            }
            fs.writeFileSync(file_root + '/' + this.id + '/variables.json', JSON.stringify(variables));
        } catch (error) {
            fs.writeFileSync(file_root + '/' + this.id + '/variables.json', JSON.stringify(variables));
        }
        return variables;
    }
    

    async runCommand(command: Array < string > ): Promise < void > {
        return new Promise((resolve, reject) => {
            const exec = GlobalDocker.getContainer(this.dockerContainerId).exec({
                Cmd: command,
                AttachStdout: true,
                AttachStderr: true,
                AttachStdin: false,
                Tty: true,
            }, (err: any, exec: any) => {
                if (err) {
                    reject(err);
                    return;
                }
                exec.start((err: any, stream: any) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    //GlobalDocker.modem.demuxStream(stream, process.stdout, process.stderr);

                    //redirect output to HandleStdout function
                    stream.on('data', (data: any) => {
                        this.HandleStdout(data);
                    });

                    stream.on('end', () => {
                        resolve();
                    });
                });
            });
        });
    }

    async RunProcedure(procedureName: string): Promise<void> {
        let procedure = this.GetProcedure(procedureName);
        if (procedure == null) throw new Error('Procedure not found');
        if (this.status == ProcedureStatus.Stopped) throw new Error('Service is not running');
        let variables = this.LoadVariables();
    
        for (let script of procedure.script) {
            let NewProcedureScript = new Array<string>();
    
            for (let i = 0; i < script.length; i++) {
                let NewScript = script[i];
                for (const variable of variables) {
                    NewScript = NewScript.replace(variable.placeholder, variable.default);
                }
                NewProcedureScript.push(NewScript);
            }
    
            console.log('Running procedure: ' + NewProcedureScript);
            await this.runCommand(NewProcedureScript);
        }

    }

    RenderVariables(): any{
        let variables = this.LoadVariables();

        let env = this.environment.map((env: string) => {
            for (const variable of variables) {
                env = env.replace(variable.placeholder, variable.default);
            }
            return env;
        });

        let volumes = this.volumes.map((volume: string) => {
            for (const variable of variables) {
                volume = volume.replace(variable.placeholder, variable.default);
            }
            return volume;
        });

        let image = this.image;
        for (const variable of variables) {
            image = image.replace(variable.placeholder, variable.default);
        }

        this.image = image;

        let ports = this.ports.map((port: Port) => {
            //convert port to string
            port.hostPort = port.hostPort.toString();
            port.containerPort = port.containerPort.toString();
            port.protocol = port.protocol.toString();
            for (const variable of variables) {
                port.hostPort = port.hostPort.replace(variable.placeholder, variable.default);
                port.containerPort = port.containerPort.replace(variable.placeholder, variable.default);
                port.protocol = port.protocol.replace(variable.placeholder, variable.default);
            }
            return port;
        });

        return {
            ports: ports,
            volumes: volumes,
            env: env,
        };

    }

    async PostInstall() {
        //this code waits until the service is running and the container scripts controlled by docker are finished
        let finished = false;
        while (!finished) {
            let resp = await RequestDocker('/containers/' + this.dockerContainerId + '/json', 'GET') as string;
            let container = JSON.parse(resp);
            if (container.State.Running) {
                finished = true;
            }
        }
        //run install procedure
        await this.RunProcedure('install');
    }

    HandleStdout(data: any) {
        //convert data to string and remove all non ascii characters
        data = data.toString().replace(/[^\x00-\x7F]/g, "");
        //replace all color codes
        data = data.replace(/\x1b\[[0-9;]*m/g, '');
        //some of the output breaks the terminal encoding, so we need to replace it
        data = data.replace(/\u0008/g, '');
        //cast to utf8. all non utf8 characters are replaced with a space
        data = Buffer.from(data, 'binary').toString('utf8');
        //write to stdout file
        this.StdOutStream.write(data.toString());
    }

    async Start(install: boolean = false) {
        if (this.status == ProcedureStatus.Running) throw new Error('Service already running');
        if (!this.IsServiceInstalled()) throw new Error('Service not installed');
        let rv = this.RenderVariables();

        let ports = rv.ports;
        let volumes = rv.volumes;
        let env = rv.env;
        let json = this.BuildStartupJson(ports, volumes, env);
        let resp = await RequestDocker('/containers/create', 'POST', json) as string;
        let container = JSON.parse(resp);
        console.log(container);
        if (container.Id == undefined) throw new Error('Could not create container');
        let srq = await RequestDocker('/containers/' + container.Id + '/start', 'POST');
        console.log(srq);
        this.dockerContainerId = container.Id;
        this.status = ProcedureStatus.Running;

        if (install) await this.PostInstall();

        this.RunProcedure('start');
        

        return true;
    }


    async Stop() {
        if (this.status == ProcedureStatus.Stopped) throw new Error('Service is not running');
        await this.RunProcedure('stop');
        await RequestDocker('/containers/' + this.dockerContainerId + '/stop', 'POST');
        this.status = ProcedureStatus.Stopped;
        return true;
    }

    async GetServiceStatus(): Promise < ProcedureStatus > {
        try {
            if (this.status == ProcedureStatus.Stopped) return this.status;
            let resp = await RequestDocker('/containers/' + this.dockerContainerId + '/json', 'GET') as string;
            let container = JSON.parse(resp);
            if (container.State.Running) {
                this.status = ProcedureStatus.Running;
            } else {
                this.status = ProcedureStatus.Stopped;
            }
            
            let stats = await RequestDocker('/containers/' + this.dockerContainerId + '/stats?stream=false', 'GET') as string;
            let statsJson = JSON.parse(stats);
            this.Stats = Stats.GenerateStats(statsJson);

            return this.status;
        } catch (error) {
            this.status = ProcedureStatus.Stopped;
            console.log(error);
            return this.status;
        }
    }

    IsServiceInstalled(): boolean {
        //check if .installed file exists
        let filename = file_root + '/' + this.id + '/.installed';
        if (fs.existsSync(filename)) return true;
        return false;
    }

    async Install() {
        //check if service is already installed
        if (this.IsServiceInstalled()) throw new Error('Service already installed');
        //start service with install parameter
        fs.writeFileSync(file_root + '/' + this.id + '/.installed', '');
        await this.Start(true);
        //create .installed file
        return true;
    }

}

export { GcsService, ProcedureStatus };