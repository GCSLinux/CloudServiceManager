import { GcsService, ProcedureStatus } from "./Service";
import { file_root } from "./Constants";
import fs from 'fs';

function MkError(error: string): string {
    return JSON.stringify({
        error: error
    });
}

function MkInfo(info: string): string {
    return JSON.stringify({
        info: info
    });
}

let Services = new Array < GcsService > ();

function GetService(serviceName: string): GcsService | null {
    for (const service of Services) {
        if (service.id == serviceName) {
            return service;
        }
    }
    return null;
}

async function GetAllStats(): Promise < void > {
    for (const service of Services) {
        await service.GetServiceStatus();
    }
}

function LoadServices() {
    //scan directory for services
    let dirs = fs.readdirSync(file_root);
    //inside are only directories
    for (const dir of dirs) {
        LoadService(dir);
    }
    //every second, check if services are running
    setInterval(GetAllStats, 1000);
}

function LoadService(serviceName: string) : boolean{
    //if service is already loaded, return
    for (const service of Services) {
        if (service.id == serviceName) {
            return false;
        }
    }
    let service = new GcsService(serviceName);
    try {
        let file = fs.readFileSync(file_root + '/' + serviceName + '/service.yaml', 'utf8');
        service.loadFromYaml(file);
        Services.push(service);
        return true;
    } catch (error) {
        console.log(error);
        return false;
    }
}

function StartService(serviceName: string): any {
    try {
        let service = GetService(serviceName);
        if (service == null) return MkError('Service not found');
        if (!service.IsServiceInstalled()) return MkError('Service not installed');
        if (service.status == ProcedureStatus.Running) return MkInfo('Service already running');
        service.Start();
        return MkInfo('Service started');
    } catch (error:any) {
        return MkError(error.message);
    }
}

function StopService(serviceName: string): any {
    try {
        let service = GetService(serviceName);
        if (service == null) return MkError('Service not found');
        if (service.status == ProcedureStatus.Stopped) return MkInfo('Service already stopped');
        service.Stop();
        return MkInfo('Service stopped');
    } catch (error:any) {
        return MkError(error.message);
    }
}

function InstallService(serviceName: string): any {
    try {
        let service = GetService(serviceName);
        if (service == null) return MkError('Service not found');
        if (service.IsServiceInstalled()) return MkInfo('Service already installed');
        service.Install();
        return MkInfo('Service installed');
    } catch (error:any) {
        return MkError(error.message);
    }
}

function ListServices(): any {
    let services = Services.map((service: GcsService) => {
        return service.Serialize();
    });
    return JSON.stringify(services);
}

async function StopAllServices(): Promise < void > {
    for (const service of Services) {
        await service.Stop();
    }
}

export { LoadServices, StartService, StopService, InstallService, ListServices, LoadService, StopAllServices };