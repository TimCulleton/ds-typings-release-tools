import { Command } from "commander";
import figlet from "figlet";

const program = new Command();
console.log(figlet.textSync("Test"));

program
    .name("tools")
    .version("1.0.0")
    .description("Test Command")
    .command("validate")
        .description("Check the typings module definitions to see if a definition is a duplicate of TS file")
        .option("-d, --dir", "folder containing GEOTypings")