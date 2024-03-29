import * as p from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";

import { SPACEDRAGON, DEFAULT_APP_NAME } from "~/consts.js";
import { type AvailablePackages } from "~/installers/index.js";
import { getVersion } from "~/utils/getSpaceDragonVersion.js";
import { getUserPkgManager } from "~/utils/getUserPkgManager.js";
import { IsTTYError } from "~/utils/isTTYError.js";
import { logger } from "~/utils/logger.js";
import { validateAppName } from "~/utils/validateAppName.js";
import { validateImportAlias } from "~/utils/validateImportAlias.js";

interface CliFlags {
  noGit: boolean;
  noInstall: boolean;
  default: boolean;
  importAlias: string;

  /** @internal Used in CI. */
  tailwind: boolean;
}

interface CliResults {
  appName: string;
  packages: AvailablePackages[];
  flags: CliFlags;
}

const defaultOptions: CliResults = {
  appName: DEFAULT_APP_NAME,
  packages: ["tailwind"],
  flags: {
    noGit: false,
    noInstall: false,
    default: false,
    CI: false,
    tailwind: false,
  },
};

export const runCli = async (): Promise<CliResults> => {
  const cliResults = defaultOptions;

  const program = new Command()
    .name(SPACEDRAGON)
    .description("A CLI for creating web applications with the spacedragon stack")
    .argument(
      "[dir]",
      "The name of the application, as well as the name of the directory to create"
    )
    .option(
      "--noGit",
      "Explicitly tell the CLI to not initialize a new git repo in the project",
      false
    )
    .option(
      "--noInstall",
      "Explicitly tell the CLI to not run the package manager's install command",
      false
    )
    .option(
      "-y, --default",
      "Bypass the CLI and use all default options to bootstrap a new spacedragon app",
      false
    )
    /** START CI-FLAGS */
    /**
     * @experimental Used for CI E2E tests. If any of the following option-flags are provided, we
     *               skip prompting.
     */
    .option("--CI", "Boolean value if we're running in CI", false)
    /** @experimental - Used for CI E2E tests. Used in conjunction with `--CI` to skip prompting. */
    .option(
      "--tailwind [boolean]",
      "Experimental: Boolean value if we should install Tailwind CSS. Must be used in conjunction with `--CI`.",
      (value) => !!value && value !== "false"
    )
    /** @experimental - Used for CI E2E tests. Used in conjunction with `--CI` to skip prompting. */
    .option(
      "-i, --import-alias",
      "Explicitly tell the CLI to use a custom import alias",
      defaultOptions.flags.importAlias
    )
    /** END CI-FLAGS */
    .version(getVersion(), "-v, --version", "Display the version number")
    .parse(process.argv);

  // FIXME: TEMPORARY WARNING WHEN USING YARN 3. SEE ISSUE #57
  if (process.env.npm_config_user_agent?.startsWith("yarn/3")) {
    logger.warn(`  WARNING: It looks like you are using Yarn 3. This is currently not supported,
  and likely to result in a crash. Please run spacedragon with another
  package manager such as pnpm, npm, or Yarn Classic.`);
  }

  // Needs to be separated outside the if statement to correctly infer the type as string | undefined
  const cliProvidedName = program.args[0];
  if (cliProvidedName) {
    cliResults.appName = cliProvidedName;
  }

  cliResults.flags = program.opts();

  /** @internal Used for CI E2E tests. */
  if (cliResults.flags.CI) {
    cliResults.packages = [];
    if (cliResults.flags.tailwind) cliResults.packages.push("tailwind");

    return cliResults;
  }

  if (cliResults.flags.default) {
    return cliResults;
  }

  // Explained below why this is in a try/catch block
  try {
    if (process.env.TERM_PROGRAM?.toLowerCase().includes("mintty")) {
      logger.warn(`  WARNING: It looks like you are using MinTTY, which is non-interactive. This is most likely because you are 
  using Git Bash. If that's that case, please use Git Bash from another terminal, such as Windows Terminal.`);

      throw new IsTTYError("Non-interactive environment");
    }

    // if --CI flag is set, we are running in CI mode and should not prompt the user

    const pkgManager = getUserPkgManager();

    const project = await p.group(
      {
        ...(!cliProvidedName && {
          name: () =>
            p.text({
              message: "What will your project be called?",
              defaultValue: cliProvidedName,
              validate: validateAppName,
            }),
        }),
        styling: () => {
          return p.confirm({
            message: "Will you be using Tailwind CSS for styling?",
          });
        },
        ...(!cliResults.flags.noGit && {
          git: () => {
            return p.confirm({
              message:
                "Should we initialize a Git repository and stage the changes?",
              initialValue: !defaultOptions.flags.noGit,
            });
          },
        }),
        ...(!cliResults.flags.noInstall && {
          install: () => {
            return p.confirm({
              message:
                `Should we run '${pkgManager}` +
                (pkgManager === "yarn" ? `'?` : ` install' for you?`),
              initialValue: !defaultOptions.flags.noInstall,
            });
          },
        }),
      },
      {
        onCancel() {
          process.exit(1);
        },
      }
    );

    const packages: AvailablePackages[] = [];
    if (project.styling) packages.push("tailwind");

    return {
      appName: project.name ?? cliResults.appName,
      packages,
      flags: {
        ...cliResults.flags,
        noGit: !project.git ?? cliResults.flags.noGit,
        noInstall: !project.install ?? cliResults.flags.noInstall,
      },
    };
  } catch (err) {
    // If the user is not calling create-t3-app from an interactive terminal, inquirer will throw an IsTTYError
    // If this happens, we catch the error, tell the user what has happened, and then continue to run the program with a default t3 app
    if (err instanceof IsTTYError) {
      logger.warn(`
  ${SPACEDRAGON} needs an interactive terminal to provide options`);

      const shouldContinue = await p.confirm({
        message: `Continue scaffolding a default spacedragon app?`,
        initialValue: true,
      });

      if (!shouldContinue) {
        logger.info("Exiting...");
        process.exit(0);
      }

      logger.info(`Bootstrapping a default spacedragon app in ./${cliResults.appName}`);
    } else {
      throw err;
    }
  }

  return cliResults;
};
