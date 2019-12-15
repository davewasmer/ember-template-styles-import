'use strict';
/* eslint-env node */
const path = require('path');
const BroccoliFilter = require('broccoli-persistent-filter');
const Merge = require('broccoli-merge-trees');
const Concat = require('broccoli-concat');
const Funnel = require('broccoli-funnel');
const postcss = require('postcss');
const stew = require('broccoli-stew');
const postcssScss = require('postcss-scss');
const { hash } = require('spark-md5');

const extension = 'scoped.scss';

let rewriterPlugin = postcss.plugin('postcss-importable', ({ filename, deep, registerDefinedClass }) => {
  return (css) => {
    if (deep) {
      css.walkRules((rule) => {
        rule.selectors = rule.selectors.map((selector) => {
          let name = selector.slice(1);
          registerDefinedClass(filename, name)
          return '.' + generateScopedName(name, filename);
        });
      });
    } else {
      css.nodes.forEach((node) => {
        if (node.type === 'rule') {
          node.selectors = node.selectors.map((selector) => {
            let name = selector.slice(1);
            registerDefinedClass(filename, name)
            return '.' + generateScopedName(name, filename);
          });
        }
      });
    }
  };
});

class StylesRewriter extends BroccoliFilter {

  constructor(inputNode, options = {}) {
    super(inputNode, { persist: true, ...options });
    this.options = options;
    this.extensions = [ extension ];
    this.targetExtension = extension;
  }

  baseDir() {
    return __dirname;
  }

  processString(contents, relativePath) {
    let namespace = this.options.namespace;
    return postcss([
      rewriterPlugin({
        registerDefinedClass: this.options.registerDefinedClass,
        filename: `${ namespace }/${ relativePath }`,
        deep: false
      })
    ])
    .process(contents, {
      from: relativePath,
      to: relativePath,
      parser: postcssScss
    })
    .then((results) => results.css);
  }

}

function isApp(appOrAddon) {
  return !isAddon(appOrAddon);
}

function isAddon(appOrAddon) {
  return !!appOrAddon.pkg.keywords && appOrAddon.pkg.keywords.indexOf('ember-addon') > -1;
}

function isDummyAppBuild(self) {
  return isAddon(self.parent) && self.parent.name === self.project.name && self.parent.pkg === self.project.pkg;
}

function generateScopedName(name, relativePath) {
  let hashKey = `${ name }--${ relativePath }`;
  return `${ name }_${ hash(hashKey).slice(0, 5) }`;
}

module.exports = {
  name: require('./package').name,

  registerDefinedClass(file, name) {
    if (!this.definedClasses.has(file)) {
      this.definedClasses.set(file, new Set());
    }
    this.definedClasses.get(file).add(name);
  },

  registerUsedClass(file, name) {
    if (!this.usedClasses.has(file)) {
      this.usedClasses.set(file, new Set());
    }
    this.usedClasses.get(file).add(name);
  },

  included(includer) {
    this.includer = includer;
    this.definedClasses = new Map();
    this.usedClasses = new Map();
    // If we are being used inside an addon, then we want the addon's scoped styles
    // to be processed, but not the consuming app's. So we wrap the parent addon's
    // treeForAddonStyles to process them for scoping.
    if (isAddon(this.parent)) {
      let original = this.parent.treeForStyles || ((t) => t);
      let self = this;
      this.parent.treeForStyles = function(stylesInput = path.join(this.root, 'addon/styles')) {
        let originalOutput = original.call(this, stylesInput);
        let scopedOutput = self._scopedStyles(path.join(this.root, 'addon'), this.name);
        originalOutput = new Funnel(originalOutput, { srcDir: 'app/styles' });
        return stew.mv(new Merge([ originalOutput, scopedOutput ]), this.name);
      }
    }
  },

  treeForStyles() {
    let trees = [];
    if (isApp(this.parent)) {
      trees.push(this._scopedStyles(path.join(this.parent.root, 'app'), this.parent.name()));
    }
    if (isDummyAppBuild(this)) {
      trees.push(this._scopedStyles(path.join(this.project.root, 'app'), this.parent.name(), `${ this.parent.name() }-pod-styles.scss`));
      trees.push(this._scopedStyles(path.join(this.project.root, 'tests', 'dummy', 'app'), 'dummy'));
    }
    return new Merge(trees);
  },

  _scopedStyles(tree, namespace, outputFile = 'pod-styles.scss') {
    tree = new Funnel(tree, { include: [ `**/*.${extension}` ]});
    tree = new StylesRewriter(tree, {
      namespace,
      registerDefinedClass: this.registerDefinedClass.bind(this)
    });
    tree = new Concat(tree, { allowNone: true, outputFile });
    return tree;
  },

  setupPreprocessorRegistry(type, registry) {
    if (type === 'self') {
      return;
    }
    let project = this.project;
    let registerUsedClass = this.registerUsedClass.bind(this);

    registry.add('htmlbars-ast-plugin', {
      name: 'styles-transform',
      baseDir() { return __dirname },
      plugin: class {

        constructor(env) {
          this.moduleName = env.meta.moduleName;
          this.importedStylesheets = {};
          let transformer =  project.templateImportTransformers[extension];

          if (transformer && transformer.imports && transformer.imports.length) {
            let importInfos = transformer.imports.filter(imp => imp.sourceRelativePath === this.moduleName);

            importInfos.forEach(importInfo => {
              let importPath = importInfo.importPath
              let localName = importInfo.localName;
              let importedModuleName = path.isAbsolute(importPath) ? importPath.slice(1) : path.join(path.dirname(this.moduleName), importPath);
  
              this.importedStylesheets[localName] = importedModuleName;
            });
          }
        }

        transform(ast) {
          let walker = new this.syntax.Walker();
          //this.handleImportStatements(walker, ast);
          this.handleImportedStyles(walker, ast);
          return ast;
        }

        handleImportStatements(walker, ast) {
          walker.visit(ast, (node) => {
            let isImportStatement =
              node.type === 'MustacheStatement'
              && node.path.type === 'PathExpression'
              && node.path.original === 'import';

            if (isImportStatement) {
              let importPath = node.params[2].value;
              let localName = node.params[0].original;
              let importedModuleName = path.isAbsolute(importPath) ? importPath.slice(1) : path.join(path.dirname(this.moduleName), importPath);

              this.importedStylesheets[localName] = importedModuleName;

              let comment = this.syntax.builders.comment('imported styles');
              this.transformNode(node, comment);
            }
          });
        }

        handleImportedStyles(walker, ast) {
          walker.visit(ast, (node) => {
            if (node.type === 'ElementNode') {
              let classAttr = node.attributes.find((a) => a.name === 'class');
              if (classAttr) {
                if (classAttr.value.type === 'MustacheStatement') {
                  this.rewriteMustacheStatement(classAttr.value);
                } else if (classAttr.value.type === 'ConcatStatement') {
                  let dynamicParts = classAttr.value.parts.filter((part) => part.type === 'MustacheStatement');
                  dynamicParts.forEach((part) => {
                    this.rewriteMustacheStatement(part);
                  });
                }
              }
            }
          });
        }

        rewriteMustacheStatement(statement) {
          let rootObjectReferenced = statement.path.parts[0];
          let importedStylesheetPath = this.importedStylesheets[rootObjectReferenced];
          if (importedStylesheetPath) {
            let importedClass = statement.path.parts[1];
            let rewrittenClass = generateScopedName(importedClass, importedStylesheetPath);
            let string = this.syntax.builders.text(rewrittenClass);
            registerUsedClass(importedStylesheetPath, importedClass);
            this.transformNode(statement, string);
          }
        }

        transformNode(node, target) {
          Object.assign(node, target);
          Object.keys(node).forEach((key) => {
            if (!target[key]) {
              delete node[key];
            }
          });
        }

      }
    });
  },

  postBuild() {
    return;
    // if (this.definedClasses.size > 0) {
    //   // console.warn(`Available imported stylesheets:\n  ${ [ ...this.definedClasses.keys() ].join('\n  ') }`)
    // }
    // if (this.definedClasses.size > 0 || this.usedClasses.size > 0) {
    //   this.definedClasses.forEach((definedClasses, file) => {
    //     let usedClasses = this.usedClasses.get(file);
    //     if (!usedClasses) {
    //       // eslint-disable-next-line no-console
    //       console.warn(`Warning: Unused CSS. It looks like you defined some scoped styles in ${ file } but you didn't use them anywhere.`);
    //       return;
    //     }
    //     let unusedClasses = difference(definedClasses, usedClasses);
    //     unusedClasses.forEach((className) => {
    //       // eslint-disable-next-line no-console
    //       console.warn(`Warning: Unused CSS. It looks like you defined a "${ className }" class in ${ file } but you didn't use it anywhere.`);
    //     })
    //     let missingClasses = difference(usedClasses, definedClasses);
    //     missingClasses.forEach((className) => {
    //       // eslint-disable-next-line no-console
    //       console.warn(`Warning: Missing CSS. It looks like you try to use "${ className }" class imported from ${ file } in your templates, but that file doesn't define a CSS class with that name.`);
    //     })
    //   });
    //   this.usedClasses.forEach((usedClasses, file) => {
    //     let definedClasses = this.definedClasses.get(file);
    //     if (!definedClasses) {
    //       // eslint-disable-next-line no-console
    //       console.warn(`Warning: Missing CSS. It looks like you tried to import styles from ${ file }, but that file doesn't exist`);
    //     }
    //   });
    // }
  }

};
