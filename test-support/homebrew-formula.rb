# Load the formula with Homebrew's actual DSL. Never run its install hooks.
require "formulary"
require "install_steps"
require "json"

formula_path = Pathname.new(ARGV.fetch(0))
formula = Formulary.from_contents("fetchary", formula_path, formula_path.read)
formula.instance_variable_set(:@prefix_returns_versioned_prefix, true)
steps = formula.post_install_steps
raise "Expected one post-install step" unless steps.length == 1

step = steps.first
raise "Expected a run step" unless step.fetch("type") == "run"
raise "Incorrect Node command" unless step.fetch("command") == {
  "path" => "opt/node/bin/node", "base" => "homebrew_prefix"
}
raise "Network access not enabled" unless step["network_access"] == true
raise "Incorrect browser command" unless step.fetch("args").drop(1) == ["browser", "install", "--no-history"]
raise "Incorrect browser write permission" unless step.fetch("writable_paths") == [{
  "path" => "lib/node_modules/fetchary/.fetchary-browsers", "base" => "libexec"
}]

runner = Homebrew::InstallSteps::Runner.new(context: formula)
command = runner.send(:resolve_command, step.fetch("command"))
args = step.fetch("args").map { |arg| runner.send(:expand_template_tokens, arg) }
raise "Wrong Node executable" unless command.to_s == (HOMEBREW_PREFIX/"opt/node/bin/node").to_s
raise "Incorrect versioned CLI path" unless args.first == (formula.libexec/"lib/node_modules/fetchary/cli/index.js").to_s

puts JSON.generate({ version: formula.pkg_version.to_s, command: command.to_s, args: args })
