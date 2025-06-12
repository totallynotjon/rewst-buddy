

export default interface FolderStructure {
    id: string;
    label: string;
    children?: FolderStructure[];
    ext: string;
}