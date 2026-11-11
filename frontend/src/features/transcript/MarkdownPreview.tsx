import styles from './MarkdownPreview.module.css';

// 只支持后端实际会返回的几种行：标题、列表、待办与
// 加粗元信息，不引入完整的 Markdown 解析器。
export default function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className={styles.markdown}>
      {content.split('\n').map((line, index) => {
        if (line.startsWith('## ')) return <h3 key={index}>{line.slice(3)}</h3>;
        if (line.startsWith('### '))
          return <h4 key={index}>{line.slice(4)}</h4>;
        if (line.startsWith('- [ ] '))
          return (
            <p className={styles.checkLine} key={index}>
              <span className={styles.checkBox} aria-hidden="true" />{' '}
              {line.slice(6)}
            </p>
          );
        if (line.startsWith('- '))
          return (
            <p className={styles.bulletLine} key={index}>
              <span aria-hidden="true">•</span> {line.slice(2)}
            </p>
          );
        if (/^\*\*(.+)\*\*/.test(line)) {
          const match = line.match(/^\*\*(.+?)\*\*　?(.*)$/);
          return (
            <p className={styles.metaLine} key={index}>
              <strong>{match?.[1]}</strong>
              {match?.[2]}
            </p>
          );
        }
        return line ? (
          <p key={index}>{line}</p>
        ) : (
          <div className={styles.lineSpace} key={index} />
        );
      })}
    </div>
  );
}
