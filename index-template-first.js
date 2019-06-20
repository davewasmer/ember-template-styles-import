'use strict';

/* eslint-env node */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const BroccoliFilter = require('broccoli-persistent-filter');
const Merge = require('broccoli-merge-trees');
const Concat = require('broccoli-concat');
const Funnel = require('broccoli-funnel');
const md5Hex = require('md5-hex');
const postcss = require('postcss');
const postcssModules = require('postcss-modules');
const debug = require('broccoli-debug');
const stew = require('broccoli-stew');
const tmp = require('tmp');

class StylesRewriter extends BroccoliFilter {

  constructor(inputNode, options = {}) {
    super(inputNode, { persist: true, ...options });
    this.options = options;
    this.extensions = [ 'scoped.scss' ];
    this.targetExtension = 'scoped.scss';
  }

  baseDir() {
    return __dirname;
  }

  processString(contents, relativePath) {
    let importDescriptor = this.options.imports.find((i) => i.importedModuleName === relativePath);
    if (importDescriptor) {
      return postcss([
        postcssModules({
          getJSON() {},
          generateScopedName(name) {
            let usedClass = importDescriptor.usedClasses.find((c) => c.classUsed === name);
            if (!usedClass) {
              console.warn(`Unused class in css module: ${ name } (${ relativePath })`);
              return name;
            }
            return usedClass.rewrittenClass;
          }
        })
      ])
      .process(contents, { from: relativePath, to: relativePath })
      .then((results) => { console.log('rewriting css', relativePath); return results; })
      .then((results) => results.css);
    }
    return contents;
  }

}

module.exports = {
  name: require('./package').name,

  projectImports: [],

  treeForStyles(tree = 'app') {
    let { podModulePrefix, modulePrefix } = this.project.config();
    let podsPath = path.relative(modulePrefix, podModulePrefix);
    let podStyles = new Funnel(tree, { include: [ `${ podsPath }/**/*.scoped.scss` ]});
    podStyles = new StylesRewriter(podStyles, { podModulePrefix, imports: this.projectImports });
    podStyles = new debug(podStyles, { label: 'treeForStyles' })
    podStyles = new Concat(podStyles, { outputFile: 'pod-styles.scss' });
    return podStyles;
  },

  setupPreprocessorRegistry(type, registry) {
    // let { podModulePrefix } = this.project.config();

    let projectImports = this.projectImports;

    registry.add('htmlbars-ast-plugin', {
      name: 'styles-transform',
      baseDir() { return __dirname },
      plugin: class {

        constructor(env) {
          this.moduleName = env.meta.moduleName;
          console.log('ast transforming', this.moduleName);
          this.imports = [];
        }

        transform(ast) {
          let walker = new this.syntax.Walker();
          this.handleImportStatements(walker, ast);
          this.handleImportedStyles(walker, ast);
          return ast;
        }

        handleImportStatements(walker, ast) {
          walker.visit(ast, (node) => {
            if (this.isImportStatement(node)) {
              let importDescriptor = this.importDescriptorFrom(node);
              this.imports.push(importDescriptor);
              projectImports.push(importDescriptor);
              this.rewriteImport(node);
            }
          });
        }

        isImportStatement(node) {
          return node.type === 'MustacheStatement'
                 && node.path.type === 'PathExpression'
                 && node.path.original === 'import';
        }

        importDescriptorFrom(node) {
          let relativeImportPath = node.params[2].value;
          let localName = node.params[0].original;
          let source = this.moduleName;
          let importedModuleName = path.join(path.dirname(source), relativeImportPath);
          return {
            localName,
            importedModuleName,
            usedClasses: []
          };
        }

        rewriteImport(node) {
          let comment = this.syntax.builders.comment('imported styles');
          this.transformNode(node, comment);
        }

        handleImportedStyles(walker, ast) {
          walker.visit(ast, (node) => {
            let importDescriptor = this.getStyleImportUsed(node);
            if (importDescriptor) {
              let usage = this.registerStyleUsage(importDescriptor, node);
              this.rewriteStyleUsage(usage, node);
            }
          });
        }

        getStyleImportUsed(node) {
          if (node.type === 'ElementNode') {
            let classAttr = node.attributes.find((a) => a.name === 'class');
            return classAttr
                   && classAttr.value.type === 'MustacheStatement'
                   && this.imports.find((i) => i.localName === classAttr.value.path.parts[0]);
          }
        }

        registerStyleUsage(importDescriptor, node) {
          let classUsed = node.attributes.find((a) => a.name === 'class').value.path.parts[1];
          let usage = {
            classUsed,
            rewrittenClass: this.namespacedClassFor(classUsed)
          };
          importDescriptor.usedClasses.push(usage);
          return usage;
        }

        rewriteStyleUsage(usage, node) {
          let string = this.syntax.builders.text(usage.rewrittenClass);
          let classAttr = node.attributes.find((a) => a.name === 'class');
          this.transformNode(classAttr.value, string);
        }

        namespacedClassFor(originalClass) {
          return originalClass + '-hashme';
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

    // registry.add('css', {
    //   name: 'ember-template-styles-import',
    //   ext: 'scss',
    //   toTree: (tree) => {
    //     let scopedStylesTree = new StylesRewriter(tree, { podModulePrefix, imports: projectImports });
    //     return new Merge([ tree, scopedStylesTree ], { overwrite: true });
    //   }
    // });
  }

};
