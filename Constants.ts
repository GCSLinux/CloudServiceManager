import Docker from 'dockerode';

const file_root = '/etc/gcs/services/services';

const SOCKET_PATH = '/var/run/gcs.sock';

const DockerSocket = '/var/run/docker.sock';

const GlobalDocker = new Docker();

export { file_root, SOCKET_PATH, GlobalDocker, DockerSocket };
