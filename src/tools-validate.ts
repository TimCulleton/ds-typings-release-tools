import { Command } from "commander";
// import figlet from "figlet";

import fs = require("fs");
import path = require("path");
import ora from 'ora';
import chalk from "chalk";

const program = new Command();
program
    .description("Validate the existing Typing Definitions by checking for duplicate module declarations")
    .option("-d, --dir <type>", "Path to folder containing GEOTypings")
    .option("-p, --preq <type>", "BSF Preq Bath")
    .parse(process.argv);

const options = program.opts();

const geoTypingsDir: string = options.dir || "./";
const preqPath: string = options.preq || `//dsone/rnd/r426rel/BSF;//dsone/rnd/r426rel/BSFTST`

const Regex_ModuleIdExtractor = /module (["|'])(.*?[^\\])["|']/;
const Regex_IgnoredModules = /DS\/DSTypings|DS\/TypingsTempModules|DS\/RDFSharedTypings/;

interface ModuleData {
    id: string;
    geoTypingsPath: string;
    sourceTypingsPath?: string;
    sourceTypingsExist?: boolean;
}
type ModuleDataMap = Map<string, ModuleData>;

function getTypingsModuleDefinitionIds(dirPath: string, moduleData?: ModuleDataMap): ModuleDataMap {
    moduleData = moduleData ?? new Map();
    const fileStats = fs.lstatSync(dirPath);

    if (fileStats.isDirectory()) {
        const dirContents = fs.readdirSync(dirPath);
        dirContents.forEach(item => {
            const itemPath = path.join(dirPath, item);
            getTypingsModuleDefinitionIds(itemPath, moduleData);
        });
    } else if (fileStats.isFile() && dirPath.endsWith(".d.ts")) {
        parseDTSFile(dirPath, moduleData);
    }
    return moduleData;
}

function parseDTSFile(filePath: string, moduleData: ModuleDataMap): void {
    const fileStats = fs.lstatSync(filePath);
    if (!fileStats.isFile()) { return; }

    const lines = fs.readFileSync(filePath, { encoding: "utf-8" }).split(/\r?\n/);
    for (const line of lines) {

        if (!line) { continue; }
        const result = Regex_ModuleIdExtractor.exec(line)
        if (!result) { continue; }

        const moduleId = result[2]
        if (moduleId.startsWith("DS/") && !Regex_IgnoredModules.test(moduleId)) {
            moduleData.set(moduleId, { id: moduleId, geoTypingsPath: filePath });
        }
    }
}

function checkForExistenceOfCompiledDTS(bsfPreqPath: string, moduleData: ModuleDataMap): ModuleData[] {
    const preqPaths = bsfPreqPath.split(";");
    const duplicateModules: ModuleData[] = [];
    for (const moduleItem of moduleData.values()) {
        const modulePath = moduleItem.id.split("/").slice(1).join("/")+ ".d.ts";
        // const modulePath = moduleTokens.slice(1)

        for (const preqPath of preqPaths) {
            const dtsPath = path.join(preqPath, "win_b64\\typings", modulePath)
            if ( fs.existsSync(dtsPath) ) {
                moduleItem.sourceTypingsExist = true;
                moduleItem.sourceTypingsPath = dtsPath;
                duplicateModules.push(moduleItem);
                break;
            }
        }
    }
    return duplicateModules;
}

const parseModuleDataSpinner = ora("Extracting Module IDs");
parseModuleDataSpinner.color = "blue";
parseModuleDataSpinner.start();
const parsedModuleData = getTypingsModuleDefinitionIds(geoTypingsDir.trim());
parseModuleDataSpinner.succeed();

const testForDuplicateDefs = ora("Testing for Duplicate module definitions");
testForDuplicateDefs.spinner = "growHorizontal";
testForDuplicateDefs.start();

const duplicateModules = checkForExistenceOfCompiledDTS(preqPath.trim(), parsedModuleData);

if (!duplicateModules.length) {
    testForDuplicateDefs.succeed("No Duplicate Modules");
} else {
    testForDuplicateDefs.warn("Duplicate Modules Detected");
    const prefix = "    - ";
    const warning = chalk.hex('#FFA500');
    for (const duplicate of duplicateModules) {
        console.log(warning(`${prefix} ` + duplicate.id));
    }
}


// console.log(parsedModuleData);
