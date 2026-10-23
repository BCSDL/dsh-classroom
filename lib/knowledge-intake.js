// Classroom-specific policy. Ordinary documents/photos do not become course data.
export function knowledgeIntake(text,hasCourse=false){
 const negativeImport=/(?:不|别|无需|禁止)(?:要|再)?[^。\n，,]{0,10}(?:导入|归档|保存)[^。\n，,]{0,12}(?:课堂|课程|知识库)|do not (?:import|archive|save)/i.test(text);
 const withoutNegatives=text.replace(/(?:不|别|无需|禁止)(?:要|再)?[^。\n，,]{0,8}(?:课堂知识库|课程|课堂|录音|知识库)[^。\n，,]{0,5}/g,'');
 const course=hasCourse||/课堂|课程|课件|录音|笔记|知识库|复习|之前保存|记得|course|lecture|knowledge|saved notes/i.test(withoutNegatives);
 return {search:course&&!negativeImport,importUploads:course&&!negativeImport};
}
