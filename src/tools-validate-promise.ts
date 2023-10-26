import { Command, OptionValues } from "commander";
// import figlet from "figlet";

import fs = require("fs/promises");
import { existsSync } from "fs";

import path = require("path");
import ora from 'ora';
import chalk from "chalk";

const program = new Command();
program
    .description("Validate the existing Typing Definitions by checking for duplicate module declarations")
    .option("-c, --config <type>", "Path to config file, if not specified will attempt to load from working directory")
    .option("-d, --dir <type>", "Path to folder containing GEOTypings")
    .option("-p, --preq <type>", "BSF Preq Bath")
    .option("-o, --out <type>", "Out File, if not specified will be in the working directory")
    .option("-d, --debug", "Enable debug mode")
    .parse(process.argv);

const options = program.opts();

const Regex_ModuleIdExtractor = /module (["|'])(.*?[^\\])["|']/;
const Regex_IgnoredModules = /DS\/DSTypings|DS\/TypingsTempModules|DS\/RDFSharedTypings/;
const Regex_Commented_Line = /(\/\/|\/\*|\*)(.*?declare module)/;

interface ModuleData {
    id: string;
    geoTypingsPath: string;
    sourceTypingsPath?: string;
    sourceTypingsExist?: boolean;
}
type ModuleDataMap = Map<string, ModuleData>;

interface GenericConfig {
    validateConfig?: ValidateConfig;
}

interface ValidateConfig {
    typingsDirectory: string;
    preqPath: string;
    knownDuplicateModuleIds: string[];
    outFilePath: string;
}

interface ValidateResult {
    status: "Success" | "Warning" | "Error",
    typingsDirectory: string;
    preqPath: string;
    newDuplicateModules: string[];
    knownDuplicateModules: string[];
    redundantDuplicateModules: string[];
}

async function fileExistsAsync(path: string): Promise<boolean> {
    try {
        await fs.access(path, fs.constants.F_OK);
        return true;
    } catch (e) {
        return false;
    }
}

// const x = new Promise<void>(resolve => resolve());
// await x;
async function getConfigSettings(cmdOptions: OptionValues): Promise<ValidateConfig> {
    const configPath = (cmdOptions.config || "./tools_config.json").trim();
    let validateConfig: Partial<ValidateConfig> = { knownDuplicateModuleIds: [] };

    try {
        if (existsSync(configPath)) {
            const fileData = await fs.readFile(configPath, { encoding: "utf-8" });
            validateConfig = (JSON.parse(fileData) as GenericConfig ).validateConfig as ValidateConfig;
        }
    } catch (e) {
        //swallow
    }

    validateConfig.typingsDirectory = (options.dir?.trim() ?? validateConfig.typingsDirectory) ?? "./";
    validateConfig.preqPath = options.preq?.trim() ?? validateConfig.preqPath;
    validateConfig.outFilePath = options.out?.trim() ?? "./validate_result.json"

    if (!validateConfig.preqPath) { throw Error("No PreReq Path defined"); }
    return validateConfig as ValidateConfig;
}

async function getTypingsModuleDefinitionIds(dirPath: string, moduleData?: ModuleDataMap): Promise<ModuleDataMap> {
    moduleData = moduleData ?? new Map();
    const fileStats = await fs.lstat(dirPath);
    // const fileStats = fs.lstatSync(dirPath);

    if (fileStats.isDirectory()) {
        // const dirContents = fs.readdirSync(dirPath);
        const dirContents = await fs.readdir(dirPath);
        const promises = dirContents.map(item => {
            const itemPath = path.join(dirPath, item);
            return getTypingsModuleDefinitionIds(itemPath, moduleData);
        })

        await Promise.all(promises);
    } else if (fileStats.isFile() && dirPath.endsWith(".d.ts")) {
        await parseDTSFile(dirPath, moduleData);
    }
    return moduleData;
}

async function parseDTSFile(filePath: string, moduleData: ModuleDataMap): Promise<void> {
    const fileStats = await fs.lstat(filePath);
    if (!fileStats.isFile()) { return; }

    const fileContent = await fs.readFile(filePath, { encoding: "utf-8"});
    const lines = fileContent.split(/\r?\n/);
    for (const line of lines) {

        // skip if line is blank or is a commented line
        if (!line || Regex_Commented_Line.test(line)) { continue; }
        const result = Regex_ModuleIdExtractor.exec(line)
        if (!result) { continue; }

        const moduleId = result[2]
        if (moduleId.startsWith("DS/") && !Regex_IgnoredModules.test(moduleId)) {
            moduleData.set(moduleId, { id: moduleId, geoTypingsPath: filePath });
        }
    }
}

async function checkForExistenceOfCompiledDTS(bsfPreqPath: string, moduleData: ModuleDataMap): Promise<ModuleData[]> {
    const preqPaths = bsfPreqPath.split(";");
    const duplicateModules: ModuleData[] = [];
    for (const moduleItem of moduleData.values()) {
        const modulePath = moduleItem.id.split("/").slice(1).join("/") + ".d.ts";
        // const modulePath = moduleTokens.slice(1)

        for (const preqPath of preqPaths) {
            const dtsPath = path.join(preqPath, "win_b64\\typings", modulePath)
            
            if (await fileExistsAsync(dtsPath)) {
                moduleItem.sourceTypingsExist = true;
                moduleItem.sourceTypingsPath = dtsPath;
                duplicateModules.push(moduleItem);
                break;
            }
        }
    }
    return duplicateModules;
}

async function writeValidateResult(outPath: string, result: ValidateResult): Promise<void> {
    try {
        fs.writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
    } catch (e) {
        // swallow
    }
}

const config = await getConfigSettings(options);
const parseModuleDataSpinner = ora("Extracting Module IDs");
parseModuleDataSpinner.color = "blue";
parseModuleDataSpinner.start();
// const parsedModuleData = getTypingsModuleDefinitionIds(geoTypingsDir.trim());
const parsedModuleData = await getTypingsModuleDefinitionIds(config.typingsDirectory)
parseModuleDataSpinner.succeed();

const testForDuplicateDefs = ora("Testing for Duplicate module definitions");
testForDuplicateDefs.spinner = "growHorizontal";
testForDuplicateDefs.start();

// const duplicateModules = checkForExistenceOfCompiledDTS(preqPath.trim(), parsedModuleData);
const duplicateModules = await checkForExistenceOfCompiledDTS(config.preqPath, parsedModuleData);

const validateResult: ValidateResult = {
    status: "Success",
    typingsDirectory: config.typingsDirectory,
    preqPath: config.preqPath,
    newDuplicateModules: [],
    knownDuplicateModules: config.knownDuplicateModuleIds,
    redundantDuplicateModules: [],
}

if (!duplicateModules.length) {
    testForDuplicateDefs.succeed("No Duplicate Modules");
} else {
    const knownModulesSet = config.knownDuplicateModuleIds.reduce((acc, item) => {
        acc.add(item);
        return acc;
    }, new Set<string>());

    // Extract out redundant duplicated
    const redundantModules = config.knownDuplicateModuleIds.filter(knownDupe => !duplicateModules.some(dupe => dupe.id === knownDupe));
    const newDuplicateModules = duplicateModules.filter(dupeModule => !knownModulesSet.has(dupeModule.id));

    const prefix = "    - ";
    if (newDuplicateModules.length) {
        testForDuplicateDefs.fail("New Duplicate Modules Detected");
        validateResult.status = "Error";
    } else {
        testForDuplicateDefs.warn("Known Duplicate Modules Exist");
        validateResult.status = "Warning";
    }

    // List new Dupes
    if (newDuplicateModules.length) {
        console.log(chalk.red("New Duplicate Modules"))
        newDuplicateModules.forEach(dupe => {
            console.log(chalk.red(`${prefix} ` + dupe.id));
        })
    }

    // List known Dupes
    if (knownModulesSet.size) {
        const warning = chalk.hex('#FFA500');
        console.log(chalk)
        knownModulesSet.forEach(knownDupe => {
            console.log(warning(`${prefix} ` + knownDupe));
        });
    }
    
    // List Redundant Dupes
    if (redundantModules.length) {
        console.log(chalk.blackBright("Redundant Duplicate Module Ids"));
        redundantModules.forEach(redundantDupe => {
            console.log(chalk.blackBright(`${prefix} ` + redundantDupe));
        });
    }

    validateResult.newDuplicateModules = newDuplicateModules.map( x => x.id);
    validateResult.redundantDuplicateModules = redundantModules;
}

await writeValidateResult(config.outFilePath, validateResult);

// Ok we have parsed out the module ids and only attempted to extract modules that are not commented out and not a GEOTypings / temp
// Next we have tested for the existence of the d.ts in the preq path
// then spat it out

// console.log(parsedModuleData);
