// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == 'object' && typeof module == 'object')
    // CommonJS
    mod(require('../../lib/codemirror'));
  else if (typeof define == 'function' && define.amd)
    // AMD
    define(['../../lib/codemirror'], mod);
  // Plain browser env
  else mod(CodeMirror);
})(function(CodeMirror) {
  'use strict';

  CodeMirror.registerHelper('wordChars', 'r', /[\w.]/);

  CodeMirror.defineMode('r', function(config) {
    function wordObj(str) {
      var words = str.split(' '),
        res = {};
      for (var i = 0; i < words.length; ++i) res[words[i]] = true;
      return res;
    }
    var atoms = wordObj(
      'NULL NA Inf NaN NA_integer_ NA_real_ NA_complex_ NA_character_',
    );
    var builtins = wordObj('list quote bquote eval return call parse deparse');
    var keywords = wordObj('if else repeat while function for in next break');
    var blockkeywords = wordObj('if else repeat while function for');
    var opChars = /[+\-*\/^<>=!&|~$:]/;
    var curPunc;

    function tokenBase(stream, state) {
      curPunc = null;
      var ch = stream.next();
      if (ch == '#') {
        stream.skipToEnd();
        return 'comment';
      } else if (ch == '0' && stream.eat('x')) {
        stream.eatWhile(/[\da-f]/i);
        return 'number';
      } else if (ch == '.' && stream.eat(/\d/)) {
        stream.match(/\d*(?:e[+\-]?\d+)?/);
        return 'number';
      } else if (/\d/.test(ch)) {
        stream.match(/\d*(?:\.\d+)?(?:e[+\-]\d+)?L?/);
        return 'number';
      } else if (ch == "'" || ch == '"') {
        state.tokenize = tokenString(ch);
        return 'string';
      } else if (ch == '`') {
        stream.match(/[^`]+`/);
        return 'variable-3';
      } else if (ch == '.' && stream.match(/.[.\d]+/)) {
        return 'keyword';
      } else if (/[\w\.]/.test(ch) && ch != '_') {
        stream.eatWhile(/[\w\.]/);
        var word = stream.current();
        if (atoms.propertyIsEnumerable(word)) return 'atom';
        if (keywords.propertyIsEnumerable(word)) {
          // Block keywords start new blocks, except 'else if', which only starts
          // one new block for the 'if', no block for the 'else'.
          if (
            blockkeywords.propertyIsEnumerable(word) &&
            !stream.match(/\s*if(\s+|$)/, false)
          )
            curPunc = 'block';
          return 'keyword';
        }
        if (builtins.propertyIsEnumerable(word)) return 'builtin';
        return 'variable';
      } else if (ch == '%') {
        if (stream.skipTo('%')) stream.next();
        return 'operator variable-2';
      } else if (
        (ch == '<' && stream.eat('-')) ||
        (ch == '<' && stream.match('<-')) ||
        (ch == '-' && stream.match(/>>?/))
      ) {
        return 'operator arrow';
      } else if (ch == '=' && state.ctx.argList) {
        return 'arg-is';
      } else if (opChars.test(ch)) {
        if (ch == '$') return 'operator dollar';
        stream.eatWhile(opChars);
        return 'operator';
      } else if (/[\(\){}\[\];]/.test(ch)) {
        curPunc = ch;
        if (ch == ';') return 'semi';
        return null;
      } else {
        return null;
      }
    }

    function tokenString(quote) {
      return function(stream, state) {
        if (stream.eat('\\')) {
          var ch = stream.next();
          if (ch == 'x') stream.match(/^[a-f0-9]{2}/i);
          else if (
            (ch == 'u' || ch == 'U') &&
            stream.eat('{') &&
            stream.skipTo('}')
          )
            stream.next();
          else if (ch == 'u') stream.match(/^[a-f0-9]{4}/i);
          else if (ch == 'U') stream.match(/^[a-f0-9]{8}/i);
          else if (/[0-7]/.test(ch)) stream.match(/^[0-7]{1,2}/);
          return 'string-2';
        } else {
          var next;
          while ((next = stream.next()) != null) {
            if (next == quote) {
              state.tokenize = tokenBase;
              break;
            }
            if (next == '\\') {
              stream.backUp(1);
              break;
            }
          }
          return 'string';
        }
      };
    }

    var ALIGN_YES = 1,
      ALIGN_NO = 2,
      BRACELESS = 4;

    function push(state, type, stream) {
      state.ctx = {
        type: type,
        indent: state.indent,
        flags: 0,
        column: stream.column(),
        prev: state.ctx,
      };
    }
    function setFlag(state, flag) {
      var ctx = state.ctx;
      state.ctx = {
        type: ctx.type,
        indent: ctx.indent,
        flags: ctx.flags | flag,
        column: ctx.column,
        prev: ctx.prev,
      };
    }
    function pop(state) {
      state.indent = state.ctx.indent;
      state.ctx = state.ctx.prev;
    }

    return {
      startState: function() {
        return {
          tokenize: tokenBase,
          ctx: { type: 'top', indent: -config.indentUnit, flags: ALIGN_NO },
          indent: 0,
          afterIdent: false,
        };
      },

      token: function(stream, state) {
        if (stream.sol()) {
          if ((state.ctx.flags & 3) == 0) state.ctx.flags |= ALIGN_NO;
          if (state.ctx.flags & BRACELESS) pop(state);
          state.indent = stream.indentation();
        }
        if (stream.eatSpace()) return null;
        var style = state.tokenize(stream, state);
        if (style != 'comment' && (state.ctx.flags & ALIGN_NO) == 0)
          setFlag(state, ALIGN_YES);

        if (
          (curPunc == ';' || curPunc == '{' || curPunc == '}') &&
          state.ctx.type == 'block'
        )
          pop(state);
        if (curPunc == '{') push(state, '}', stream);
        else if (curPunc == '(') {
          push(state, ')', stream);
          if (state.afterIdent) state.ctx.argList = true;
        } else if (curPunc == '[') push(state, ']', stream);
        else if (curPunc == 'block') push(state, 'block', stream);
        else if (curPunc == state.ctx.type) pop(state);
        else if (state.ctx.type == 'block' && style != 'comment')
          setFlag(state, BRACELESS);
        state.afterIdent = style == 'variable' || style == 'keyword';
        return style;
      },

      indent: function(state, textAfter) {
        if (state.tokenize != tokenBase) return 0;
        var firstChar = textAfter && textAfter.charAt(0),
          ctx = state.ctx,
          closing = firstChar == ctx.type;
        if (ctx.flags & BRACELESS) ctx = ctx.prev;
        if (ctx.type == 'block')
          return ctx.indent + (firstChar == '{' ? 0 : config.indentUnit);
        else if (ctx.flags & ALIGN_YES) return ctx.column + (closing ? 0 : 1);
        else return ctx.indent + (closing ? 0 : config.indentUnit);
      },

      lineComment: '#',
    };
  });

  CodeMirror.defineMIME('text/x-rsrc', 'r');
});
